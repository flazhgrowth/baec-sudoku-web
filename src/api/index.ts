import { createHttpApi } from './httpApi';
import { createHttpAuthApi } from './httpAuthApi';
import { createMockApi } from './mockApi';
import { createMockAuthApi } from './mockAuthApi';
import type { AuthApi } from './auth';
import type { SudokuApi } from './types';

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '/ms/sudous/api/v1';
const http = import.meta.env.VITE_API_MODE === 'http';

export const api: SudokuApi = http ? createHttpApi(baseUrl) : createMockApi();
export const authApi: AuthApi = http ? createHttpAuthApi(baseUrl) : createMockAuthApi();

export * from './auth';
export * from './errors';
export * from './types';
