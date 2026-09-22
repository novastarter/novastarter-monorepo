/**
 * Public entry point of `@novastarter/database-driver-turso`: the {@link DatabaseDriverTurso} class, its options and
 * the default export for consumers that import the driver without a named binding.
 */
import { DatabaseDriverTurso } from './lib/driver.js';

export { DatabaseDriverTurso, type DatabaseDriverTursoConfig, MEMORY_URL } from './lib/driver.js';
export { localFilePath } from './lib/local-file-path.js';
export default DatabaseDriverTurso;
