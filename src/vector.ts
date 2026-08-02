import type { Column, VectorValue } from './types';
import type { DialectEncoder } from './engine';

export function isVectorColumn(column: Column): boolean {
  return /^vector$/i.test(column.type);
}

/**
 * mysql2 represents a NULL native VECTOR as an empty array today. Keep this
 * tolerant of equivalent binary/view representations used by other type-cast
 * configurations while leaving the nullable decision to the field metadata.
 */
export function isEmptyVectorRepresentation(value: unknown): boolean {
  if (Array.isArray(value) || Buffer.isBuffer(value)) {
    return value.length === 0;
  }
  return ArrayBuffer.isView(value) && value.byteLength === 0;
}

export function validateVector(
  value: unknown,
  dimensions?: number
): asserts value is VectorValue {
  if (!Array.isArray(value) || value.length === 0) {
    const received = value === null
      ? 'null'
      : Array.isArray(value)
        ? 'an empty array'
        : typeof value;
    throw Error(
      `vector value must be a non-empty array of finite numbers; received ${received}`
    );
  }
  if (dimensions !== undefined && value.length !== dimensions) {
    throw Error(
      `vector value has ${value.length} dimensions; expected ${dimensions}`
    );
  }
  if (value.some(entry => typeof entry !== 'number' || !Number.isFinite(entry))) {
    throw Error('vector value must contain only finite numbers');
  }
}

export function encodeVector(
  value: unknown,
  column: Column,
  encoder: DialectEncoder
): string {
  validateVector(value, column.dimensions);
  const literal = encoder.escape(JSON.stringify(value));
  return encoder.dialect === 'mysql'
    ? `string_to_vector(${literal})`
    : literal;
}

export function decodeVector(value: unknown, column: Column): VectorValue {
  let decoded: unknown = value;
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value);
    } catch {
      throw Error(`invalid vector value: ${value}`);
    }
  } else if (Buffer.isBuffer(value)) {
    if (value.length % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw Error(`invalid vector binary length: ${value.length}`);
    }
    decoded = Array.from(
      { length: value.length / Float32Array.BYTES_PER_ELEMENT },
      (_, index) => value.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT)
    );
  } else if (ArrayBuffer.isView(value)) {
    decoded = Array.from(value as unknown as ArrayLike<number>);
  }
  validateVector(decoded, column.dimensions);
  return decoded;
}
