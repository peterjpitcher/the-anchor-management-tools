'use client';

import { useState, useMemo, useCallback } from 'react';

interface UseTablePipelineOptions<T extends Record<string, unknown>> {
  data: T[];
  searchFields: (item: T) => string[];
  defaultSortKey?: string;
  defaultSortDirection?: 'asc' | 'desc';
  itemsPerPage?: number;
  filterFn?: (item: T, filters: Record<string, unknown>) => boolean;
}

interface UseTablePipelineReturn<T> {
  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  // Sort
  sortKey: string;
  sortDirection: 'asc' | 'desc';
  handleSort: (key: string) => void;
  // Pagination
  currentPage: number;
  setCurrentPage: (page: number) => void;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  setItemsPerPage: (count: number) => void;
  // Filters
  filters: Record<string, unknown>;
  setFilters: (filters: Record<string, unknown>) => void;
  updateFilter: (key: string, value: unknown) => void;
  clearFilters: () => void;
  // Output
  pageData: T[];
  filteredData: T[];
}

export function useTablePipeline<T extends Record<string, unknown>>(
  options: UseTablePipelineOptions<T>
): UseTablePipelineReturn<T> {
  const {
    data,
    searchFields,
    defaultSortKey = '',
    defaultSortDirection = 'asc',
    itemsPerPage: defaultItemsPerPage = 25,
    filterFn,
  } = options;

  const [searchQuery, setSearchQueryRaw] = useState('');
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(defaultSortDirection);
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(defaultItemsPerPage);
  const [filters, setFiltersRaw] = useState<Record<string, unknown>>({});

  // Wrap setters that should reset to page 1
  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryRaw(query);
    setCurrentPage(1);
  }, []);

  const setFilters = useCallback((newFilters: Record<string, unknown>) => {
    setFiltersRaw(newFilters);
    setCurrentPage(1);
  }, []);

  const updateFilter = useCallback((key: string, value: unknown) => {
    setFiltersRaw((prev) => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersRaw({});
    setCurrentPage(1);
  }, []);

  const handleSort = useCallback(
    (key: string) => {
      if (key === sortKey) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDirection('asc');
      }
      setCurrentPage(1);
    },
    [sortKey]
  );

  const setItemsPerPage = useCallback((count: number) => {
    setPerPage(count);
    setCurrentPage(1);
  }, []);

  // Pipeline: raw data -> search -> structured filters -> sort -> paginate
  const filteredData = useMemo(() => {
    let result = data;

    // 1. Free-text search
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((item) =>
        searchFields(item).some(
          (field) => field != null && String(field).toLowerCase().includes(query)
        )
      );
    }

    // 2. Structured filters
    if (filterFn) {
      const hasActiveFilters = Object.values(filters).some(
        (v) => v !== undefined && v !== null && v !== ''
      );
      if (hasActiveFilters) {
        result = result.filter((item) => filterFn(item, filters));
      }
    }

    // 3. Sort
    if (sortKey) {
      result = [...result].sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];

        // Nulls sort last regardless of direction
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        let comparison: number;

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          comparison = aVal - bVal;
        } else {
          comparison = String(aVal).localeCompare(String(bVal));
        }

        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    return result;
  }, [data, searchQuery, searchFields, filterFn, filters, sortKey, sortDirection]);

  // Pagination
  const totalItems = filteredData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));

  // Clamp currentPage to totalPages
  const clampedPage = Math.min(currentPage, totalPages);

  const pageData = useMemo(() => {
    const start = (clampedPage - 1) * perPage;
    return filteredData.slice(start, start + perPage);
  }, [filteredData, clampedPage, perPage]);

  return {
    // Search
    searchQuery,
    setSearchQuery,
    // Sort
    sortKey,
    sortDirection,
    handleSort,
    // Pagination
    currentPage: clampedPage,
    setCurrentPage,
    totalPages,
    totalItems,
    itemsPerPage: perPage,
    setItemsPerPage,
    // Filters
    filters,
    setFilters,
    updateFilter,
    clearFilters,
    // Output
    pageData,
    filteredData,
  };
}
