/**
 * Tests of `utils/joinPath`: forward-slash joining with `.`/`..` resolution, independent of the platform.
 */
import { expect, test } from 'vitest';
import { confinePath, joinPath } from './join-path.js';

test('Joins segments with a single forward slash', () => {
	// 1. The plain case, relative and absolute: `/` between segments and nothing else changed
	expect(joinPath('uploads', 'avatars', 'me.png')).toBe('uploads/avatars/me.png');
	expect(joinPath('/root', 'file.txt')).toBe('/root/file.txt');
});

test('Collapses repeated and mixed separators', () => {
	// 1. Slashes on both sides of a join, doubled slashes and backslashes all end as one `/`
	expect(joinPath('a/', '/b')).toBe('a/b');
	expect(joinPath('a//b', 'c\\d')).toBe('a/b/c/d');
	expect(joinPath('C:\\Users', 'name')).toBe('C:/Users/name');
});

test('Drops a trailing slash', () => {
	// 1. `a/b/` and `a/b` are the same key, so the trailing separator never reaches the result
	expect(joinPath('a', 'b/')).toBe('a/b');
	expect(joinPath('a/b/')).toBe('a/b');
});

test('Skips empty segments', () => {
	// 1. An empty segment adds no separator of its own, or `''` and `'a'` would join as `/a`
	expect(joinPath('', 'a', '', 'b')).toBe('a/b');
	expect(joinPath('a', '')).toBe('a');
});

test('Answers with an empty string for no segments', () => {
	// 1. No segments, or only empty ones, is no path: not the root and not a single slash
	expect(joinPath()).toBe('');
	expect(joinPath('', '')).toBe('');

	// 2. A `.` names the current place, which is no path either
	expect(joinPath('.')).toBe('');
	expect(joinPath('.', '')).toBe('');
});

test('Resolves dot segments', () => {
	// 1. `.` names the current place, so it vanishes from the middle and from the front alike
	expect(joinPath('a', '.', 'b')).toBe('a/b');
	expect(joinPath('./a', './b')).toBe('a/b');
	expect(joinPath('.')).toBe('');
});

test('Resolves parent segments against the segments before them', () => {
	// 1. Each `..` pops the segment before it, across argument boundaries, the way `path.posix.join` does
	expect(joinPath('a', 'b', '..', 'c')).toBe('a/c');
	expect(joinPath('/root', '../etc', './passwd')).toBe('/etc/passwd');
	expect(joinPath('a/b/c', '../../d')).toBe('a/d');
});

test('Keeps a parent segment that climbs above a relative path', () => {
	// 1. Nothing to pop: the `..` stays in front, as `path.posix.join` leaves it
	expect(joinPath('a', '..', '..', 'b')).toBe('../b');
	expect(joinPath('..', 'a')).toBe('../a');
	expect(joinPath('../..', 'a', '..')).toBe('../..');
});

test('Drops a parent segment that climbs above the root', () => {
	// 1. There is nothing above `/`, so the climb is ignored and the path stays inside the root
	expect(joinPath('/', '..', 'a')).toBe('/a');
	expect(joinPath('/a', '..', '..')).toBe('/');
});

test('Keeps the root of an absolute path', () => {
	// 1. The leading `/` is not a segment to pop or collapse; it stays whatever follows it
	expect(joinPath('/')).toBe('/');
	expect(joinPath('/', 'a')).toBe('/a');
	expect(joinPath('/a', '..')).toBe('/');
});

test('Treats a Windows drive as an ordinary segment', () => {
	// 1. Only a leading `/` is a root: the drive is popped like any segment, which is the documented limit for keys
	expect(joinPath('C:\\a', '..', 'b')).toBe('C:/b');
	expect(joinPath('C:\\a', '..', '..', 'b')).toBe('b');
});

test('Answers with the root for segments that are nothing but separators, like path.posix.join', () => {
	// 1. `normalizePath` collapses `//` to nothing; the root is read from the raw join, so it is not lost with it
	expect(joinPath('/', '/')).toBe('/');
	expect(joinPath('//')).toBe('/');
	expect(joinPath('///', '.')).toBe('/');
	expect(joinPath('\\', '/')).toBe('/');
});

test('confinePath keeps a caller path under the root it is joined to', () => {
	// 1. A leading `..` has nothing to climb once rooted, so it is dropped; the rest resolves as usual
	expect(confinePath('../other/secret.txt')).toBe('other/secret.txt');
	expect(confinePath('a/../../b')).toBe('b');
	expect(confinePath('/avatars/../me.png')).toBe('me.png');
	expect(confinePath('avatars/me.png')).toBe('avatars/me.png');

	// 2. Empty and dot-only paths stay empty, so a `list('')` still means the whole root
	expect(confinePath('')).toBe('');
	expect(confinePath('.')).toBe('');
	expect(confinePath('/')).toBe('');

	// 3. Joined under a root, the result never leaves it
	expect(joinPath('media', confinePath('../../etc/passwd'))).toBe('media/etc/passwd');
	expect(joinPath('', confinePath('/x'))).toBe('x');
});

test('Refuses a segment that is not a string instead of dropping or spelling it out', () => {
	// 1. A missing caller path must not quietly name the root — the storage drivers build their keys with this
	expect(() => joinPath('uploads', undefined as unknown as string)).toThrow(TypeError);
	expect(() => joinPath('a', null as unknown as string)).toThrow(TypeError);
	expect(() => joinPath('a', 123 as unknown as string)).toThrow(TypeError);
	expect(() => confinePath(undefined as unknown as string)).toThrow(TypeError);
});
