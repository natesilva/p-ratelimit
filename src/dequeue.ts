interface Node<T> {
  value: T;
  prev: Node<T>;
  next: Node<T>;
}

export class Dequeue<T> {
  private _length = 0;
  private head: Node<T> = null;
  private tail: Node<T> = null;

  get length() { return this._length; }

  clear() {
    this.head = this.tail = null;
    this._length = 0;
  }

  push(value: T) {
    const newNode: Node<T> = {
      value,
      prev: this.tail,
      next: null
    };

    if (this._length) {
      this.tail.next = newNode;
      this.tail = newNode;
    } else {
      this.head = this.tail = newNode;
    }
    this._length++;
  }

  pop(): T {
    const result = this.tail;
    this.tail = this.tail.prev;
    this._length--;
    if (!this._length) {
      this.head = this.tail = null;
    }
    return result.value;
  }

  unshift(value: T) {
    const newNode: Node<T> = {
      value,
      prev: null,
      next: this.head
    };

    if (this._length) {
      this.head.prev = newNode;
      this.head = newNode;
    } else {
      this.head = this.tail = newNode;
    }

    this._length++;
  }

  shift(): T {
    const result = this.head;
    this.head = this.head.next;
    this._length--;
    if (!this._length) {
      this.head = this.tail = null;
    }
    return result.value;
  }

  peekFront(): T {
    if (this._length) {
      return this.head.value;
    }
    return undefined;
  }

  peekBack(): T {
    if (this._length) {
      return this.tail.value;
    }
    return undefined;
  }
}
