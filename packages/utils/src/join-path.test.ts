/**
 * Tests of `utils/joinPath`: forward-slash joining with `.`/`..` resolution, independent of the platform.
 */
import { expect, test } from 'vitest';
import { joinPath } from './join-path.js';

test('Joins segments with a single forward slash', () => {
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
	expect(joinPath('a', 'b/')).toBe('a/b');
	expect(joinPath('a/b/')).toBe('a/b');
});

test('Skips empty segments', () => {
	expect(joinPath('', 'a', '', 'b')).toBe('a/b');
	expect(joinPath('a', '')).toBe('a');
});

test('Answers with an empty string for no segments', () => {
	expect(joinPath()).toBe('');
	expect(joinPath('', '')).toBe('');

	// 1. A `.` names the current place, which is no path either
	expect(joinPath('.')).toBe('');
	expect(joinPath('.', '')).toBe('');
});

test('Resolves dot segments', () => {
	expect(joinPath('a', '.', 'b')).toBe('a/b');
	expect(joinPath('./a', './b')).toBe('a/b');
	expect(joinPath('.')).toBe('');
});

test('Resolves parent segments against the segments before them', () => {
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
	expect(joinPath('/')).toBe('/');
	expect(joinPath('/', 'a')).toBe('/a');
	expect(joinPath('/a', '..')).toBe('/');
});

test('Treats a Windows drive as an ordinary segment', () => {
	// 1. Only a leading `/` is a root: the drive is popped like any segment, which is the documented limit for keys
	expect(joinPath('C:\\a', '..', 'b')).toBe('C:/b');
	expect(joinPath('C:\\a', '..', '..', 'b')).toBe('b');
});
