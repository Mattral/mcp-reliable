import chalk from "chalk";

/** An error with a user-facing message and an optional actionable hint, shown without a stack trace. */
export class CliError extends Error {
  constructor(
    message: string,
    public readonly hint?: string
  ) {
    super(message);
    this.name = "CliError";
  }
}

/**
 * Wraps a command action so that thrown errors are rendered as a friendly
 * message (+ hint, if any) rather than a raw stack trace — DX principle #2
 * in the spec ("errors should be helpful"). Set `MCP_RELIABLE_DEBUG=1` to
 * see the full stack for troubleshooting mcp-reliable itself.
 */
export function withFriendlyErrors<Args extends unknown[]>(
  action: (...args: Args) => Promise<void>
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    try {
      await action(...args);
    } catch (error) {
      const debug = process.env.MCP_RELIABLE_DEBUG === "1";
      if (error instanceof CliError) {
        console.error(chalk.red(`✖ ${error.message}`));
        if (error.hint) console.error(chalk.dim(`  ${error.hint}`));
      } else if (error instanceof Error) {
        console.error(chalk.red(`✖ ${error.message}`));
        if (!debug) {
          console.error(chalk.dim("  Set MCP_RELIABLE_DEBUG=1 to see the full stack trace."));
        }
      } else {
        console.error(chalk.red(`✖ ${String(error)}`));
      }
      if (debug && error instanceof Error && error.stack) {
        console.error(chalk.dim(error.stack));
      }
      process.exitCode = 1;
    }
  };
}
