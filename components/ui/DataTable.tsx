'use client';

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { Table, Group, Text, ActionIcon, Center, Loader } from '@mantine/core';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

/**
 * Generic TanStack Table wrapper — the ONLY place useReactTable is called
 * (SYSTEM_PROMPT.md #3). Domain modules pass columns/data, never configure
 * the table engine themselves. Sorting is client-side by default; pass
 * `manualSorting` + `onSortingChange` for server-side sort.
 */
export function DataTable<T>({
  columns,
  data,
  isLoading,
  emptyLabel = 'No data',
  manualSorting = false,
  sorting: controlledSorting,
  onSortingChange,
  minWidth = 640,
  maxHeight = 'calc(100vh - 320px)',
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  isLoading?: boolean;
  emptyLabel?: string;
  manualSorting?: boolean;
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  /** Minimum table width before horizontal scrolling kicks in. */
  minWidth?: number;
  /** Caps vertical overflow inside the table's own scroll container instead of the page body. */
  maxHeight?: number | string;
}) {
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const sorting = controlledSorting ?? internalSorting;

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      const next =
        typeof updater === 'function' ? updater(sorting) : updater;
      onSortingChange ? onSortingChange(next) : setInternalSorting(next);
    },
    manualSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
  });

  if (isLoading) {
    return (
      <Center py="xl">
        <Loader color="pine" />
      </Center>
    );
  }

  if (data.length === 0) {
    return (
      <Center py="xl">
        <Text c="dimmed">{emptyLabel}</Text>
      </Center>
    );
  }

  return (
    <Table.ScrollContainer minWidth={minWidth} mah={maxHeight} style={{ overflowY: 'auto' }}>
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <Table.Tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sortDir = header.column.getIsSorted();
                const isCentered =
                  (header.column.columnDef.meta as { align?: 'center' } | undefined)?.align === 'center';
                return (
                  <Table.Th
                    key={header.id}
                    onClick={
                      canSort
                        ? header.column.getToggleSortingHandler()
                        : undefined
                    }
                    style={{
                      ...(canSort ? { cursor: 'pointer' } : {}),
                      // Opt-in only — a column with no explicit `size` in its
                      // ColumnDef sizes to content instead of the library's
                      // 150px default, so one flexible column (usually the
                      // first) can absorb leftover width naturally.
                      ...(header.column.columnDef.size !== undefined
                        ? { width: header.getSize() }
                        : {}),
                    }}
                  >
                    {/* justify="center" cuando la celda también centra (meta.align) — si no, el
                        label+ícono de orden queda pegado a la izquierda mientras el badge de la
                        fila se centra en todo el ancho de la columna, y quedan desalineados entre
                        sí aunque cada uno esté "bien" resuelto por separado. */}
                    <Group gap={4} wrap="nowrap" justify={isCentered ? 'center' : 'flex-start'} w="100%">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                      {canSort && (
                        <ActionIcon variant="transparent" size="xs" c="dimmed">
                          {sortDir === 'asc' && <ChevronUp size={14} />}
                          {sortDir === 'desc' && <ChevronDown size={14} />}
                          {!sortDir && <ChevronsUpDown size={14} />}
                        </ActionIcon>
                      )}
                    </Group>
                  </Table.Th>
                );
              })}
            </Table.Tr>
          ))}
        </Table.Thead>
        <Table.Tbody>
          {table.getRowModel().rows.map((row) => (
            <Table.Tr key={row.id}>
              {row.getVisibleCells().map((cell) => {
                const isCentered =
                  (cell.column.columnDef.meta as { align?: 'center' } | undefined)?.align === 'center';
                return (
                  <Table.Td
                    key={cell.id}
                    style={
                      cell.column.columnDef.size !== undefined
                        // maxWidth + overflow: a sized <td> in an auto-layout <table> still grows
                        // to fit nowrap/long content unless the cell itself clips — width alone
                        // (as used for unsized columns) isn't enough for truncated cells.
                        ? { width: cell.column.getSize(), maxWidth: cell.column.getSize(), overflow: 'hidden' }
                        : undefined
                    }
                  >
                    {isCentered ? (
                      // flex, no textAlign: el contenido típico acá (StatusBadge) es
                      // display:'block' con su propio width — textAlign solo centra contenido
                      // inline, así que no lo mueve. flex centra sin importar el display del
                      // hijo, y además no depende de que la columna se haya estirado más allá
                      // del contenido (table-layout:auto no garantiza eso).
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    ) : (
                      flexRender(cell.column.columnDef.cell, cell.getContext())
                    )}
                  </Table.Td>
                );
              })}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
