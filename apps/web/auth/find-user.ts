import type { AuthDriverCredentialsConfig } from '@novastarter/auth-driver-credentials';
import { eq } from 'drizzle-orm';
import { useDb, users } from '../db';

/**
 * Find the account a sign-in form names, for the credentials driver.
 *
 * Accounts sign in by email. The typed address is trimmed and lower-cased, so the app stores addresses in lower case
 * too — people type them in any case.
 *
 * @param identifier - What the person typed into the email field.
 * @returns The user's id as a string — the id format of `@novastarter/auth` — and password hash; `null` when there is
 * no such account.
 */
export const findUser: AuthDriverCredentialsConfig['findUser'] = async (identifier) => {
	// 1. One row by the unique address; the driver spends the same time on a miss, so no timing tells them apart
	const [user] = await useDb()
		.select({ id: users.id, passwordHash: users.passwordHash })
		.from(users)
		.where(eq(users.email, identifier.trim().toLowerCase()))
		.limit(1);

	return user ? { id: String(user.id), passwordHash: user.passwordHash } : null;
};

/**
 * Store a password hash made with a newer cost, when the credentials driver rehashed at sign-in.
 *
 * @param id - The user's id, as {@link findUser} gave it.
 * @param hash - The new hash.
 * @returns Once it is stored.
 */
export const saveRehash: NonNullable<AuthDriverCredentialsConfig['onRehash']> = async (id, hash) => {
	// 1. The id travels as a string through the auth package; the column is an integer
	await useDb()
		.update(users)
		.set({ passwordHash: hash })
		.where(eq(users.id, Number(id)));
};
