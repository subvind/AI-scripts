import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Function to perform type checking based on file extension
// NOTE: not currently used
export async function typeCheck(file) {
  let ext = path.extname(file);
  let cmd = `tsc ${file} --noEmit`;
  try {
    var result = await execAsync(cmd);
    return result.stderr.trim() || result.stdout.trim();
  } catch (error) {
    return error.stderr.trim();
  }
}