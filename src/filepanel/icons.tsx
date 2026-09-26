import type { ReactNode } from 'react';

// Outline icons for the file tree and toolbar buttons; stroke follows `currentColor` so they track the theme.
function Svg({ name, size = 14, children }: { name: string; size?: number; children: ReactNode }) {
  return (
    <svg
      className={`icon icon-${name}`}
      data-icon={name}
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const ChevronIcon = () => (
  <Svg name="chevron">
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const FolderIcon = ({ open }: { open: boolean }) =>
  open ? (
    <Svg name="folder-open">
      <path d="M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </Svg>
  ) : (
    <Svg name="folder">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </Svg>
  );

export const FileIcon = () => (
  <Svg name="file">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M9 13h6M9 17h6" />
  </Svg>
);

export const GearIcon = () => (
  <Svg name="gear" size={16}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const PlusIcon = () => (
  <Svg name="plus" size={16}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const CopyIcon = () => (
  <Svg name="copy" size={15}>
    <rect x="8" y="8" width="14" height="14" rx="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Svg>
);

export const CodeIcon = () => (
  <Svg name="code" size={15}>
    <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
  </Svg>
);

export const EyeIcon = () => (
  <Svg name="eye" size={15}>
    <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const EyeOffIcon = () => (
  <Svg name="eye-off" size={15}>
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c4.29 0 8.17 2.62 9.94 6.65a1 1 0 0 1 0 .7 10.8 10.8 0 0 1-1.44 2.49" />
    <path d="M14.08 14.16a3 3 0 0 1-4.24-4.24" />
    <path d="M17.48 17.5A10.75 10.75 0 0 1 2.06 12.35a1 1 0 0 1 0-.7 10.8 10.8 0 0 1 4.45-5.14" />
    <path d="m2 2 20 20" />
  </Svg>
);

export const ListIcon = () => (
  <Svg name="list" size={15}>
    <path d="M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg name="close" size={16}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const MinusIcon = () => (
  <Svg name="minus" size={16}>
    <path d="M5 12h14" />
  </Svg>
);

export const FitIcon = () => (
  <Svg name="fit" size={15}>
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </Svg>
);

export const AlertIcon = () => (
  <Svg name="alert" size={16}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4.5M12 16h.01" />
  </Svg>
);

// Context menu icons.
export const DownloadIcon = () => (
  <Svg name="download">
    <path d="M12 15V3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5" />
  </Svg>
);

export const PencilIcon = () => (
  <Svg name="pencil">
    <path d="M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4" />
  </Svg>
);

export const FolderPenIcon = () => (
  <Svg name="folder-pen">
    <path d="M2 11.5V5a2 2 0 0 1 2-2h3.9c.7 0 1.3.3 1.7.9l.8 1.2c.4.6 1 .9 1.7.9H20a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-9.5" />
    <path d="M11.38 12.62a1 1 0 0 1 3 3L9.37 20.6a2 2 0 0 1-.86.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.86Z" />
  </Svg>
);

export const FolderInputIcon = () => (
  <Svg name="folder-input">
    <path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1" />
    <path d="M2 13h10M9 16l3-3-3-3" />
  </Svg>
);

export const FolderPlusIcon = () => (
  <Svg name="folder-plus">
    <path d="M12 10v6M9 13h6" />
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </Svg>
);

export const TrashIcon = () => (
  <Svg name="trash">
    <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6" />
  </Svg>
);

export const CloseOthersIcon = () => (
  <Svg name="close-others">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
    <path d="m13 10 4 4M17 10l-4 4" />
  </Svg>
);

export const CloseRightIcon = () => (
  <Svg name="close-right">
    <path d="M17 12H3M11 18l6-6-6-6M21 5v14" />
  </Svg>
);

export const CloseAllIcon = () => (
  <Svg name="close-all">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="m15 9-6 6M9 9l6 6" />
  </Svg>
);

export const ArrowUpIcon = () => (
  <Svg name="arrow-up">
    <path d="m6 15 6-6 6 6" />
  </Svg>
);

export const ArrowDownIcon = () => (
  <Svg name="arrow-down">
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const SidebarLeftIcon = () => (
  <Svg name="sidebar-left" size={16}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Svg>
);

export const SidebarRightIcon = () => (
  <Svg name="sidebar-right" size={16}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </Svg>
);

export const ArrowLeftIcon = () => (
  <Svg name="arrow-left" size={16}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </Svg>
);

export const ArrowRightIcon = () => (
  <Svg name="arrow-right" size={16}>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </Svg>
);

export const SearchIcon = () => (
  <Svg name="search">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4" />
  </Svg>
);
