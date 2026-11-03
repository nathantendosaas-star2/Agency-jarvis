const bcrypt = require("bcryptjs");

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
      reject(new Error("Run this command in a terminal that supports hidden password input."));
      return;
    }

    let value = "";
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
    };

    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0008" || char === "\u007f") {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        } else if (char >= " " && char <= "~") {
          value += char;
          process.stdout.write("*");
        }
      }
    };

    process.stdin.on("data", onData);
  });
}

(async () => {
  try {
    const password = await readHidden("Choose an administrator password (12+ characters): ");
    if (password.length < 12 || password.length > 200) {
      throw new Error("Password must be between 12 and 200 characters.");
    }
    const confirmation = await readHidden("Confirm password: ");
    if (password !== confirmation) throw new Error("Passwords do not match.");

    const hash = await bcrypt.hash(password, 12);
    process.stdout.write("\nAdd this value to ADMIN_PASSWORD_HASH in your local .env and Render environment settings:\n\n");
    process.stdout.write(hash + "\n\n");
    process.stdout.write("Do not share the password or commit the hash to a public repository.\n");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
})();