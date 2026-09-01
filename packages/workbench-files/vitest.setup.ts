import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Without globals the library's own auto-cleanup never registers, and one
// case's DOM is still mounted while the next one queries.
afterEach(cleanup);
