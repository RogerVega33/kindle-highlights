import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, Book, BookDetail, BookListQuery, BookSort, BooksResponse } from '../../shared/types';
import { BOOKS_PER_PAGE } from '../../shared/limits';
import { libraryApi } from '../api/library';
import { messageOf } from '../lib/format';
import { readCurrent } from '../lib/current-read';

type Notify = (message: string, error?: boolean) => void;

function mergeFields<T extends Book>(book: T, fields: Partial<Book>): T {
  return { ...book, ...fields, updatedAt: fields.updatedAt && fields.updatedAt > book.updatedAt ? fields.updatedAt : book.updatedAt };
}

export function useLibrary(notify: Notify) {
  const [listing, setListing] = useState<BooksResponse>({
    books: [], page: 1, pageSize: BOOKS_PER_PAGE, totalBooks: 0,
    totalAnnotations: 0, matchingBooks: 0, totalPages: 1,
  });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<BookSort>('recent');
  const [selectedBook, setSelectedBook] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const listSequence = useRef(0);
  const detailSequence = useRef(0);
  const mutationVersion = useRef(0);
  const selectedId = useRef<string | null>(null);
  const listOptions = useRef<Required<BookListQuery>>({ page: 1, query: '', sort: 'recent' });
  const listController = useRef<AbortController | null>(null);
  const searchTimer = useRef<number | null>(null);

  const clearPendingSearch = useCallback(() => {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
  }, []);

  const loadBooks = useCallback(async () => {
    clearPendingSearch();
    const sequence = ++listSequence.current;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    const options = { ...listOptions.current };
    setLoading(true);
    setLoadError('');
    try {
      await readCurrent({
        read: () => libraryApi.listBooks(options, controller.signal),
        isActive: () => sequence === listSequence.current,
        version: () => mutationVersion.current,
        commit: response => {
          listOptions.current.page = response.page;
          setListing(response);
        },
      });
    } catch (cause) {
      if (sequence === listSequence.current) setLoadError(messageOf(cause));
    } finally {
      if (sequence === listSequence.current) setLoading(false);
    }
  }, [clearPendingSearch]);

  useEffect(() => {
    void loadBooks();
    return () => {
      listSequence.current++;
      detailSequence.current++;
      listController.current?.abort();
      clearPendingSearch();
    };
  }, [loadBooks, clearPendingSearch]);

  function changeQuery(value: string) {
    setQuery(value);
    listOptions.current = { ...listOptions.current, query: value, page: 1 };
    listSequence.current++;
    listController.current?.abort();
    clearPendingSearch();
    setLoading(true);
    setLoadError('');
    searchTimer.current = window.setTimeout(() => {
      searchTimer.current = null;
      void loadBooks();
    }, 250);
  }

  function changeSort(value: BookSort) {
    setSort(value);
    listOptions.current = { ...listOptions.current, sort: value, page: 1 };
    void loadBooks();
  }

  function changePage(page: number) {
    if (!Number.isSafeInteger(page) || page < 1 || page === listOptions.current.page) return;
    listOptions.current = { ...listOptions.current, page };
    void loadBooks();
  }

  const cancelOpening = useCallback(() => {
    detailSequence.current++;
    setOpeningId(null);
    setDetailLoading(false);
  }, []);

  const backToLibrary = useCallback(() => {
    cancelOpening();
    selectedId.current = null;
    setSelectedBook(null);
  }, [cancelOpening]);

  const openBook = useCallback(async (book: Book) => {
    const sequence = ++detailSequence.current;
    setOpeningId(book.id);
    try {
      await readCurrent({
        read: () => libraryApi.getBook(book.id),
        isActive: () => sequence === detailSequence.current,
        version: () => mutationVersion.current,
        commit: detail => {
          selectedId.current = book.id;
          setSelectedBook(detail);
          window.scrollTo({ top: 0, behavior: 'instant' });
        },
      });
    } catch (cause) {
      if (sequence === detailSequence.current) notify(messageOf(cause), true);
    } finally {
      if (sequence === detailSequence.current) setOpeningId(null);
    }
  }, [notify]);

  async function refreshAfterImport() {
    mutationVersion.current++;
    await loadBooks();
    const id = selectedId.current;
    if (!id) return;
    const sequence = ++detailSequence.current;
    setDetailLoading(true);
    try {
      await readCurrent({
        read: () => libraryApi.getBook(id),
        isActive: () => sequence === detailSequence.current && selectedId.current === id,
        version: () => mutationVersion.current,
        commit: setSelectedBook,
      });
    } catch (cause) {
      if (sequence === detailSequence.current) notify(messageOf(cause), true);
    } finally {
      if (sequence === detailSequence.current) setDetailLoading(false);
    }
  }

  function patchBook(id: string, fields: Partial<Book>) {
    mutationVersion.current++;
    setListing(previous => ({ ...previous, books: previous.books.map(book => book.id === id ? mergeFields(book, fields) : book) }));
    setSelectedBook(previous => previous?.id === id ? mergeFields(previous, fields) : previous);
    void loadBooks();
  }

  function applyCoverUpdate(book: Book) {
    patchBook(book.id, { coverUrl: book.coverUrl, updatedAt: book.updatedAt });
  }

  function applyMetadataUpdate(book: Book) {
    patchBook(book.id, { title: book.title, author: book.author, updatedAt: book.updatedAt });
    notify('Datos del libro actualizados.');
  }

  function applyAnnotationDelete(book: BookDetail) {
    patchBook(book.id, { highlightCount: book.highlightCount, noteCount: book.noteCount, updatedAt: book.updatedAt });
    setSelectedBook(previous => previous?.id === book.id ? { ...previous, annotations: book.annotations } : previous);
    notify('Anotación eliminada.');
  }

  function applyTextUpdate(annotation: Annotation) {
    mutationVersion.current++;
    setSelectedBook(previous => previous?.id === annotation.bookId ? {
      ...previous, annotations: previous.annotations.map(item => item.id === annotation.id ? annotation : item),
    } : previous);
    notify('Anotación actualizada.');
    void loadBooks();
  }

  function removeBook(id: string) {
    mutationVersion.current++;
    cancelOpening();
    setListing(previous => ({ ...previous, books: previous.books.filter(book => book.id !== id) }));
    if (selectedId.current === id) {
      selectedId.current = null;
      setSelectedBook(null);
    }
    void loadBooks();
    notify('Libro eliminado.');
  }

  return {
    ...listing, query, sort, selectedBook, loading, detailLoading, loadError, openingId,
    changeQuery, changeSort, changePage,
    loadBooks, openBook, cancelOpening, backToLibrary, refreshAfterImport,
    applyCoverUpdate, applyMetadataUpdate, applyAnnotationDelete, applyTextUpdate, removeBook,
  };
}
