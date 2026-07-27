export class AnnotatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnotatorError";
  }
}
