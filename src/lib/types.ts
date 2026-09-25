export type Project = { id: string; name: string; host: string; path: string };
/** A group nested inside a top-level group; it cannot hold further subgroups. */
export type Subgroup = { id: string; name: string; collapsed: boolean; projects: Project[] };
export type Group = Subgroup & { subgroups: Subgroup[] };
export type ThemeMode = 'system' | 'light' | 'dark';
export type Settings = { theme: ThemeMode; uiFont: string | null; codeFont: string | null; fontSize: number; excludes: string[] };
export type Config = { version: number; groups: Group[]; settings: Settings };
export type FontFamily = { family: string; monospace: boolean };

export type EntryKind = 'file' | 'dir' | 'other';
export type Entry = { name: string; kind: EntryKind; symlink: boolean; size: number; mtime: number };
export type FileContent = { content: string; truncated: boolean };

export type Change = { path: string; isDir: boolean; removed: boolean };

export type HostState = 'idle' | 'connected' | 'error';
export type HostStatus = { host: string; state: HostState; message: string | null };

export type AppErrorKind = 'InvalidPath' | 'NotFound' | 'Binary' | 'TooLarge' | 'Ssh' | 'Timeout' | 'Config' | 'Other';
export type AppError = { kind: AppErrorKind; message: string };
