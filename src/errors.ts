/** An error whose message is safe and useful to show directly to the Discord user. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export class NotLinkedError extends UserFacingError {
  constructor() {
    super('Connect your Google account first with `/google connect`.');
    this.name = 'NotLinkedError';
  }
}
