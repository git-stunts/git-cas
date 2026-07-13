/** Fixed-size max heap that retains the oldest cache candidates. */
export default class CacheCandidateHeap {
  #items = [];
  #limit;

  constructor(limit) {
    this.#limit = limit;
  }

  add(value) {
    if (this.#items.length < this.#limit) {
      this.#items.push(value);
      this.#up(this.#items.length - 1);
      return;
    }
    if (compare(value, this.#items[0]) < 0) {
      this.#items[0] = value;
      this.#down(0);
    }
  }

  sorted() {
    return [...this.#items].sort(compare);
  }

  #up(start) {
    let index = start;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compare(this.#items[parent], this.#items[index]) >= 0) {
        return;
      }
      this.#swap(parent, index);
      index = parent;
    }
  }

  #down(start) {
    let index = start;
    while (true) {
      const child = this.#largerChild(index);
      if (child === null || compare(this.#items[index], this.#items[child]) >= 0) {
        return;
      }
      this.#swap(index, child);
      index = child;
    }
  }

  #largerChild(index) {
    const left = index * 2 + 1;
    if (left >= this.#items.length) {
      return null;
    }
    const right = left + 1;
    return right < this.#items.length && compare(this.#items[right], this.#items[left]) > 0
      ? right
      : left;
  }

  #swap(left, right) {
    [this.#items[left], this.#items[right]] = [this.#items[right], this.#items[left]];
  }
}

function compare(left, right) {
  if (left.sortKey !== right.sortKey) {
    return left.sortKey < right.sortKey ? -1 : 1;
  }
  return left.digest < right.digest ? -1 : left.digest === right.digest ? 0 : 1;
}
