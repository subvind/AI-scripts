
import fs from 'fs/promises';
import path from 'path';
import process from "process";
import { chat, MODELS, tokenCount } from '../Chat.mjs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DEPS_MODEL = "claude-3-5-sonnet-20240620"; // default model for dependency guessing
const CODE_MODEL = "claude-3-5-sonnet-20240620"; // default model for coding

// NestCoder System Prompt
// ---------------------
import { NestCoder } from './nestcoder.system-prompt';

import { predictDependencies } from './predictDependencies';

// Main function to handle the refactoring process
export async function main() {
  // Check for correct usage and parse command-line arguments
  if (process.argv.length < 3) {
    console.log("Usage: nestcoder <file> <request> [<model>]");
    process.exit(1);
  }

  let file = process.argv[2];
  let request = process.argv[3] || "";
  let model = process.argv[4] || CODE_MODEL;

  // Initialize the chat function with the specified model
  let ask = chat(model);

  // Get directory and file information
  let dir = process.cwd();
  let fileContent;
  try {
    fileContent = await fs.readFile(file, 'utf-8');
  } catch (e) {
    fileContent = "";
  }

  // If the request is empty, replace it by a default request.
  if (request.trim() === '') {
    request = ["Complete the TARGET file."].join('\n');
  }

  // If the file is empty, ask the AI to fill with an initial template
  if (fileContent.trim() === '') {
    fileContent = ["(empty file)"].join('\n');
  }

  // Collect direct and indirect dependencies
  let deps, pred;
  try {
    let { stdout } = await execAsync(`ts-deps ${file}`);
    deps = stdout.trim().split('\n');
  } catch (e) {
    deps = [];
  }

  // Predict additional dependencies
  pred = await predictDependencies(file, fileContent, request);
  pred = pred.map(dep => dep.replace(/\.ts$/, '').replace(/\/_$/, ''));
  deps = [...new Set([...deps, ...pred])];
  deps = deps.filter(dep => !path.resolve(dep).startsWith(path.resolve(file.replace(".ts",""))));

  // Read dependent files
  let depFiles = await Promise.all(deps.map(async (dep) => {
    let depPath, content;
    let path0 = path.join(dir, `${dep}.ts`);
    let path1 = path.join(dir, `${dep}/_.ts`); 
    try {
      content = await fs.readFile(path0, 'utf-8');
      depPath = path0;
    } catch (error) {
      try {
        content = await fs.readFile(path1, 'utf-8');
        depPath = path1;
      } catch (error) {
        return "";
      }
    }
    return `<FILE path="${depPath}">\n${content}\n</FILE>`;
  }));

  //console.log(dir, pred, deps, depFiles);
  //process.exit();

  // Perform initial type checking
  //let initialCheck = (await typeCheck(defName)).replace(/\x1b\[[0-9;]*m/g, '');

  // Prepare AI input
  let aiInput = [
    ...depFiles,
    `<FILE path="${file}" TARGET>`,
    fileContent,
    '</FILE>',
    //'<CHECKER>',
    //initialCheck,
    //'</CHECKER>',
    '<REQUEST>',
    request,
    '</REQUEST>'
  ].join('\n').trim();

  // Write a .prompt file with the system + aiInput strings
  await fs.writeFile('.nestcoder', NestCoder + '\n\n' + aiInput, 'utf-8');

  // Call the AI model
  let res = await ask(aiInput, { system: NestCoder, model });
  console.log("\n");

  // Extract all FILE tags from AI output
  let fileMatches = res.matchAll(/<FILE path="([^"]+)">([\s\S]*?)<\/FILE>/g);
  let filesToWrite = Array.from(fileMatches, match => ({path: match[1], content: match[2].trim()}));

  if (filesToWrite.length === 0) {
    console.error("Error: AI output does not contain any valid FILE tags.");
    process.exit(1);
  }

  //// Write each file
  //for (let fileToWrite of filesToWrite) {
      //let absolutePath = path.resolve(fileToWrite.path);
      //let currentDir = process.cwd();

      //// Check if the file is within the current working directory
      //if (!absolutePath.startsWith(currentDir)) {
      //console.error(`Error: Cannot write to file outside of current working directory: ${fileToWrite.path}`);
      //continue;
      //}

      //try {
      //await fs.writeFile(absolutePath, fileToWrite.content, 'utf-8');
      //console.log(`File updated successfully: ${fileToWrite.path}`);
      //} catch (error) {
      //console.error(`Error writing file ${fileToWrite.path}: ${error.message}`);
      //}
  //}

  // PROBLEM: the code above overwrite files, which may cause data loss. Add a backup of each overwritten file to the ./backup directory. Note the path of the back-upped file (in the same line of the "file updated..." message). NOTE: the "backup created" message must be in the SAME LINE of the "file updated" message. i.e., it should show both paths on the message: the file updated, and its location inside the .backup dir.


  // Write each file
  for (let fileToWrite of filesToWrite) {
    let absolutePath = path.resolve(fileToWrite.path);
    let currentDir = process.cwd();

    // Check if the file is within the current working directory
    if (!absolutePath.startsWith(currentDir)) {
      console.error(`Error: Cannot write to file outside of current working directory: ${fileToWrite.path}`);
      continue;
    }

    try {
      // Create backup directory if it doesn't exist
      const backupDir = path.join(currentDir, '.backup');
      await fs.mkdir(backupDir, { recursive: true });

      // Create backup file path
      const backupPath = path.join(backupDir, path.relative(currentDir, absolutePath));

      // Create necessary directories for backup file
      await fs.mkdir(path.dirname(backupPath), { recursive: true });

      // Backup existing file if it exists
      if (await fs.access(absolutePath).then(() => true).catch(() => false)) {
        await fs.copyFile(absolutePath, backupPath);
      }

      // Create necessary directories for the target file
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });

      // Write the new content
      await fs.writeFile(absolutePath, fileToWrite.content, 'utf-8');
      
      console.log(`File updated successfully: ${fileToWrite.path}`);
    } catch (error) {
      console.error(`Error writing file ${fileToWrite.path}: ${error.message}`);
    }
  }
}
  