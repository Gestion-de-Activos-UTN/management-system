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
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  isLoading?: boolean;
  emptyLabel?: string;
  manualSorting?: boolean;
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
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
    <Table.ScrollContainer minWidth={480}>
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <Table.Tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sortDir = header.column.getIsSorted();
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
                    <Group gap={4} wrap="nowrap">
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
              {row.getVisibleCells().map((cell) => (
                <Table.Td
                  key={cell.id}
                  style={
                    cell.column.columnDef.size !== undefined
                      ? { width: cell.column.getSize() }
                      : undefined
                  }
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
