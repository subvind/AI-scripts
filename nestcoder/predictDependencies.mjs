
import fs from 'fs/promises';
import path from 'path';
import { chat, MODELS, tokenCount } from '../Chat.mjs';

const DEPS_MODEL = "claude-3-5-sonnet-20240620"; // default model for dependency guessing
const CODE_MODEL = "claude-3-5-sonnet-20240620"; // default model for coding

// NestDepGuesser System Prompt
// --------------------------
import { NestDepGuesser } from './nestdepsguesser.system-prompt.mjs';

// Function to predict dependencies
export async function predictDependencies(file, fileContent, request) {
  // Function to get all Typescript files recursively
  async function getAllNestFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
      const res = path.resolve(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await getAllNestFiles(res);
        return subFiles.length > 0 ? { name: entry.name, children: subFiles } : null;
      } else if (
        entry.name.endsWith('.ts') 
        || entry.name.endsWith('.ejs') 
        || entry.name.endsWith('.stdout.txt')
      ) {
        return { name: entry.name };
      }
      return null;
    }));
    return files.filter(file => file !== null).map(file => ({...file, name: file.name.replace(/\/_$/, '')}));
  }

  // Function to build a tree structure from files
  function buildTree(files, prefix = '') {
    let result = '';
    for (const file of files) {
      if (file.children) {
        result += `${prefix}- ${file.name}/\n`;
        result += buildTree(file.children, `${prefix}  `);
      } else {
        result += `${prefix}- ${file.name}\n`;
      }
    }
    return result;
  }

  const allFiles = (await getAllNestFiles("./")).filter(file => !file.name.includes('.backup') && !file.name.includes('node_modules'));
  const defsTree = buildTree(allFiles);

  const aiInput = [
    `<FILE path="${file}">`,
    fileContent.trim(),
    '</FILE>',
    '<TREE>',
    defsTree.trim(),
    '</TREE>',
    '<REQUEST>',
    request,
    '</REQUEST>'
  ].join('\n').trim();

  const ask = chat(DEPS_MODEL);
  const res = await ask(aiInput, { system: NestDepGuesser, model: DEPS_MODEL });
  console.log("");
  console.log("");
  //console.log(aiInput);
  //console.log(res);
  //process.exit();
  //console.clear();

  const dependenciesMatch = res.match(/<DEPENDENCIES>([\s\S]*)<\/DEPENDENCIES>/);
  if (!dependenciesMatch) {
    console.error("Error: AI output does not contain a valid DEPENDENCIES tag.");
    return [];
  }

  return dependenciesMatch[1].trim().split('\n').map(dep => dep.trim());
}