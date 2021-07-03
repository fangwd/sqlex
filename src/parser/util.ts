export function atoi26(s: string) {
  let result = 0;
  for (let k = 0; k < s.length; k++) {
    const code = s.charCodeAt(k);
    if (code >= 97) {
      result = result * 26 + code - 97 + 1;
    } else {
      result = result * 26 + code - 65 + 1;
    }
  }
  return result;
}

export const arraycopy = (
  src: any[],
  srcPos: number,
  dest: any[],
  destPos: number,
  length: number
) => {
  for (let i = 0; i < length; i++) {
    dest[destPos + i] = src[srcPos + i];
  }
};

export const fill = (
  a: any[],
  fromIndex: number,
  toIndex: number,
  val: any
) => {
  for (let i = fromIndex; i < toIndex; i++) {
    a[i] = val;
  }
};

export interface PrintStream {
  print: (msg?: any) => void;
  println: (msg?: any) => void;
}

export const printStream: PrintStream = {
  print: (msg?: any) => console.log(msg),
  println: (msg?: any) => console.log(msg),
};

export class StringBuffer {
  buf: string;
  constructor() {
    this.buf = '';
  }
  append(s: string) {
    this.buf += s;
  }
  toString() {
    return this.buf;
  }
}
