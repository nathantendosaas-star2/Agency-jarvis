const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = path.resolve(process.env.JARVIS_WORKSPACE_DIR || path.join(process.cwd(), "workspace"));
const MAX_FILE_BYTES = 1024 * 1024;

async function ensureWorkspace() {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
}

function resolveWorkspacePath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error("A relative workspace file path is required.");
  }
  const normalized = path.normalize(relativePath);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`) || normalized.includes("\0")) {
    throw new Error("Path traversal is not allowed.");
  }
  const target = path.resolve(WORKSPACE_ROOT, normalized);
  if (target !== WORKSPACE_ROOT && !target.startsWith(WORKSPACE_ROOT + path.sep)) {
    throw new Error("File access is restricted to the Jarvis workspace.");
  }
  return target;
}

async function rejectSymlinkComponents(targetPath) {
  await ensureWorkspace();
  const relative = path.relative(WORKSPACE_ROOT, targetPath);
  let current = WORKSPACE_ROOT;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error("Symbolic links are not allowed in the workspace.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function listWorkspaceFiles({ directory = "." } = {}) {
  const target = resolveWorkspacePath(directory === "." ? "index" : directory);
  const base = directory === "." ? WORKSPACE_ROOT : target;
  await rejectSymlinkComponents(base);
  const entries = await fs.readdir(base, { withFileTypes: true });
  return entries.filter((entry) => !entry.isSymbolicLink()).map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? "directory" : "file"
  }));
}

async function readWorkspaceFile({ path: relativePath }) {
  const target = resolveWorkspacePath(relativePath);
  await rejectSymlinkComponents(target);
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error("Only files up to 1 MB can be read.");
  return { path: relativePath, content: await fs.readFile(target, "utf8") };
}

async function writeWorkspaceFile({ path: relativePath, content }) {
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    throw new Error("File content must be text and no larger than 1 MB.");
  }
  const target = resolveWorkspacePath(relativePath);
  await rejectSymlinkComponents(target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await rejectSymlinkComponents(target);
  await fs.writeFile(target, content, { encoding: "utf8", flag: "w" });
  return { path: relativePath, bytes: Buffer.byteLength(content, "utf8"), written: true };
}

async function executeWorkspaceCommand({ command }) {
  if (typeof command !== "string" || command.length > 300) throw new Error("A short command string is required.");
  const parts = command.trim().split(/\s+/);
  const executable = parts[0];
  let args = [];
  if (command.trim() === "node --version") args = ["--version"];
  else if (command.trim() === "npm --version") args = ["--version"];
  else if (command.trim() === "git --version") args = ["--version"];
  else if (executable === "node" && parts[1] === "--check" && parts.length === 3) {
    const target = resolveWorkspacePath(parts[2]);
    await rejectSymlinkComponents(target);
    args = ["--check", target];
  } else {
    throw new Error("Command blocked. Allowed: node --version, npm --version, git --version, or node --check <workspace-file.js>. Arbitrary shell commands are disabled.");
  }

  const bin = executable === "node" ? process.execPath : executable;
  const result = await execFileAsync(bin, args, {
    cwd: WORKSPACE_ROOT,
    timeout: 10000,
    maxBuffer: 32 * 1024,
    windowsHide: true,
    shell: false
  });
  return { command, stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: 0 };
}

async function executeAgentTool(name, args) {
  switch (name) {
    case "list_workspace_files": return listWorkspaceFiles(args || {});
    case "read_workspace_file": return readWorkspaceFile(args || {});
    case "write_workspace_file": return writeWorkspaceFile(args || {});
    case "execute_workspace_command": return executeWorkspaceCommand(args || {});
    default: throw new Error(`Unknown Jarvis tool: ${name}`);
  }
}

const GEMINI_FUNCTION_DECLARATIONS = [
  { name: "list_workspace_files", description: "List files and folders in the private Jarvis workspace.", parameters: { type: "OBJECT", properties: { directory: { type: "STRING", description: "Relative directory path; use . for workspace root." } } } },
  { name: "read_workspace_file", description: "Read a UTF-8 text file from the private Jarvis workspace.", parameters: { type: "OBJECT", properties: { path: { type: "STRING", description: "Relative file path." } }, required: ["path"] } },
  { name: "write_workspace_file", description: "Create or replace a UTF-8 text file in the private Jarvis workspace.", parameters: { type: "OBJECT", properties: { path: { type: "STRING", description: "Relative file path." }, content: { type: "STRING", description: "Complete file contents." } }, required: ["path", "content"] } },
  { name: "execute_workspace_command", description: "Run one of the explicitly allowed, non-arbitrary workspace validation commands.", parameters: { type: "OBJECT", properties: { command: { type: "STRING", description: "Allowed command string." } }, required: ["command"] } }
];

module.exports = {
  WORKSPACE_ROOT,
  GEMINI_FUNCTION_DECLARATIONS,
  executeAgentTool,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  executeWorkspaceCommand
};
