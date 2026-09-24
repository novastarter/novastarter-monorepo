/**
 * Tests of `utils/normalize-path`.
 */
import { describe, expect, it } from 'vitest';
import { normalizePath } from './normalize-path.js';

describe('normalizePath', () => {
	describe('basic path normalization', () => {
		it('returns "/" for single backslash', () => {
			// A lone separator is the root in either style, so it comes out in the forward-slash form
			expect(normalizePath('\\')).toBe('/');
		});

		it('returns "/" for single forward slash', () => {
			expect(normalizePath('/')).toBe('/');
		});

		it('returns empty string for empty input', () => {
			// Nothing to normalise; an empty path must not become the root
			expect(normalizePath('')).toBe('');
		});

		it('returns single character as-is', () => {
			// A one-character path holds no separator, so it passes through untouched
			expect(normalizePath('a')).toBe('a');
		});
	});

	describe('backslash to forward slash conversion', () => {
		it('converts backslashes to forward slashes', () => {
			// Every backslash is a separator; the segments themselves are kept
			expect(normalizePath('a\\b\\c')).toBe('a/b/c');
		});

		it('handles mixed slashes', () => {
			// Both styles in one path end up in the one form
			expect(normalizePath('a/b\\c/d')).toBe('a/b/c/d');
		});

		it('handles Windows-style paths', () => {
			// The drive letter and colon are ordinary characters to the function; only separators change
			expect(normalizePath('C:\\Users\\name\\file.txt')).toBe('C:/Users/name/file.txt');
		});
	});

	describe('consecutive slash handling', () => {
		it('collapses multiple forward slashes', () => {
			// Repeated separators name the same place; a key with `//` in it would be a different key
			expect(normalizePath('a//b///c')).toBe('a/b/c');
		});

		it('collapses multiple backslashes', () => {
			// The same for backslashes, which the split treats as separators too
			expect(normalizePath('a\\\\b\\\\\\c')).toBe('a/b/c');
		});

		it('collapses mixed consecutive slashes', () => {
			// A run of mixed separators is one separator, not one per style
			expect(normalizePath('a/\\b\\/c')).toBe('a/b/c');
		});
	});

	describe('trailing slash handling', () => {
		it('removes trailing forward slash', () => {
			// `a/b/c/` and `a/b/c` must normalise the same, so a directory key never carries a trailing slash
			expect(normalizePath('a/b/c/')).toBe('a/b/c');
		});

		it('removes trailing backslash', () => {
			expect(normalizePath('a\\b\\c\\')).toBe('a/b/c');
		});

		it('removes multiple trailing slashes', () => {
			// A run of trailing separators leaves one empty segment, which is dropped like a single one
			expect(normalizePath('a/b/c///')).toBe('a/b/c');
		});
	});

	describe('UNC path handling', () => {
		it('handles UNC paths with ?', () => {
			// The `\\?\` prefix must survive as `//?/`; collapsing it would turn the path into a relative one
			expect(normalizePath('\\\\?\\C:\\path')).toBe('//?/C:/path');
		});

		it('handles UNC paths with .', () => {
			// Same for the device namespace prefix `\\.\`
			expect(normalizePath('\\\\.\\device\\path')).toBe('//./device/path');
		});
	});

	describe('removeLeading option', () => {
		it('removes leading slash when removeLeading is true', () => {
			// An object-storage key has no leading slash, which is what the option is for
			expect(normalizePath('/a/b/c', { removeLeading: true })).toBe('a/b/c');
		});

		it('removes the leading slash of a backslash-rooted path too', () => {
			// The option is about the normalised path, not about which separator rooted the input: a Windows-style
			// absolute path used to keep its slash and yield a key starting with `/`
			expect(normalizePath('\\uploads\\a.png', { removeLeading: true })).toBe('uploads/a.png');
			expect(normalizePath('\\\\a\\b', { removeLeading: true })).toBe('a/b');
		});

		it('keeps the UNC prefix when removeLeading is true', () => {
			// `//?/` is a namespace prefix, not a root; stripping one slash of it would leave a broken path
			expect(normalizePath('\\\\?\\C:\\path', { removeLeading: true })).toBe('//?/C:/path');
		});

		it('keeps leading slash when removeLeading is false', () => {
			// An explicit `false` is the default: the absolute path stays absolute
			expect(normalizePath('/a/b/c', { removeLeading: false })).toBe('/a/b/c');
		});

		it('keeps leading slash by default', () => {
			// Without options the path is only rewritten, never made relative
			expect(normalizePath('/a/b/c')).toBe('/a/b/c');
		});

		it('handles path without leading slash with removeLeading true', () => {
			// The option must be a no-op on a relative path rather than eat its first character
			expect(normalizePath('a/b/c', { removeLeading: true })).toBe('a/b/c');
		});
	});

	describe('edge cases', () => {
		it('handles path with only slashes', () => {
			// A run of separators is the root, like a lone one: collapsing repeated separators must not lose it
			expect(normalizePath('///')).toBe('/');
			expect(normalizePath('/\\')).toBe('/');
			expect(normalizePath('///', { removeLeading: true })).toBe('');
		});

		it('handles path starting with multiple slashes', () => {
			// The leading run collapses to one slash, so the path stays absolute without a `//` root
			expect(normalizePath('///a/b')).toBe('/a/b');
		});

		it('handles relative paths', () => {
			// `.` and `..` are not resolved; the function only rewrites separators
			expect(normalizePath('./a/b')).toBe('./a/b');
		});

		it('handles parent directory references', () => {
			// Same for `..`: resolving it is `joinPath`'s job, not this function's
			expect(normalizePath('../a/b')).toBe('../a/b');
		});

		it('handles paths with dots', () => {
			// A dot inside a segment is part of the name, not a relative marker
			expect(normalizePath('a.txt')).toBe('a.txt');
			expect(normalizePath('path/to/file.txt')).toBe('path/to/file.txt');
		});

		it('handles paths with spaces', () => {
			// Only separators are touched; a space in a name is kept as it is
			expect(normalizePath('path/to/my file.txt')).toBe('path/to/my file.txt');
		});
	});

	describe('lone separator', () => {
		it('drops it too when the leading slash is to go', () => {
			// A root of `/` means the top of the bucket, which is the empty prefix, not a key starting with a slash
			expect(normalizePath('/', { removeLeading: true })).toBe('');
			expect(normalizePath('\\', { removeLeading: true })).toBe('');
			expect(normalizePath('/')).toBe('/');
		});
	});
});
