export class ParserQueue {
  private queue: string[] = [];

  add(url: string) {
    this.queue.push(url);
  }

  next(): string | undefined {
    return this.queue.shift();
  }

  size() {
    return this.queue.length;
  }
}
