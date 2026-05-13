export class ClaudePtyWrapperError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "ClaudePtyWrapperError";
    this.exitCode = exitCode;
  }
}
