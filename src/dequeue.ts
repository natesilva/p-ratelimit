import { strict as assert } from "node:assert";

interface Node<T> {
  value: T;
  prev: Node<T> | undefined;
  next: Node<T> | undefined;
}

export class Dequeue<T> {
  private _length = 0;
  private head: Node<T> | undefined = undefined;
  private tail: Node<T> | undefined = undefined;

  get length() {
    return this._length;
  }

  clear() {
    this.head = this.tail = undefined;
    this._length = 0;
  }

  push(value: T) {
    const newNode: Node<T> = {
      value,
      prev: this.tail,
      next: undefined,
    };

    if (this._length) {
      assert(this.tail);
      this.tail.next = newNode;
      this.tail = newNode;
    } else {
      this.head = this.tail = newNode;
    }
    this._length++;
  }

  pop(): T | undefined {
    if (!this._length) {
      return undefined;
    }
    assert(this.tail);
    const result = this.tail;
    this.tail = this.tail.prev;
    this._length--;
    if (!this._length) {
      this.head = this.tail = undefined;
    }
    return result.value;
  }

  unshift(value: T) {
    const newNode: Node<T> = {
      value,
      prev: undefined,
      next: this.head,
    };

    if (this._length) {
      assert(this.head);
      this.head.prev = newNode;
      this.head = newNode;
    } else {
      this.head = this.tail = newNode;
    }

    this._length++;
  }

  shift(): T | undefined {
    if (!this._length) {
      return undefined;
    }
    assert(this.head);
    const result = this.head;
    this.head = this.head.next;
    this._length--;
    if (!this._length) {
      this.head = this.tail = undefined;
    }
    return result.value;
  }

  peekFront(): T | undefined {
    if (this._length) {
      assert(this.head);
      return this.head.value;
    }
    return undefined;
  }

  peekBack(): T | undefined {
    if (this._length) {
      assert(this.tail);
      return this.tail.value;
    }
    return undefined;
  }
}
