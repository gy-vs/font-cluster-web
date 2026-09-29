import { describe, expect, it } from "vitest";
import {
  codePointSlice,
  codePointToUtf16Offset,
  utf16ToCodePointRange,
} from "../utf16";

describe("utf16 offset conversions", () => {
  it("maps codepoint indices to UTF-16 offsets including surrogate pairs", () => {
    const text = "é😃Z";
    expect([...text].length).toBe(3);
    expect(text.length).toBe(4); // UTF-16 units
    expect(codePointToUtf16Offset(text, 0)).toBe(0);
    expect(codePointToUtf16Offset(text, 1)).toBe(1);
    expect(codePointToUtf16Offset(text, 2)).toBe(3);
    expect(codePointToUtf16Offset(text, 3)).toBe(4);
  });

  it("converts UTF-16 ranges back to codepoint ranges", () => {
    const text = "a😀b😀c";
    // Selecting the first emoji: UTF-16 [1,3)
    expect(utf16ToCodePointRange(text, 1, 3)).toEqual([1, 2]);
    // Selecting the second emoji: UTF-16 [4,6)
    expect(utf16ToCodePointRange(text, 4, 6)).toEqual([3, 4]);
    expect(utf16ToCodePointRange(text, 0, 6)).toEqual([0, 4]);
  });

  it("slices by codepoint boundaries instead of splitting a surrogate pair", () => {
    const text = "é😃Z";
    expect(codePointSlice(text, 1, 2)).toBe("😃");
    // A naive text.slice(1,2) would return the lone high surrogate.
    expect(text.slice(1, 2)).toBe("\ud83d");
    expect(codePointSlice(text, 0, 3)).toBe("é😃Z");
    expect(codePointSlice(text, 0, 1)).toBe("é");
    expect(codePointSlice(text, 2, 3)).toBe("Z");
  });
});
