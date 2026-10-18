import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, Book, BookDetail, BookListQuery, BookSort, BooksResponse } from '../../shared/types';
import { BOOKS_PER_PAGE } from '../../shared/limits';
import { libraryApi } from '../api/library';
import { ApiError } from '../api/request';
import { messageOf } from '../lib/format';
import { readCurrent } from '../lib/current-read';
import { bookIdFromPath, createBookNavigation } from '../lib/book-navigation';

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
  const [bookId, setBookId] = useState<string | null>(() => typeof window === 'undefined' ? null : bookIdFromPath(window.location.pathname));
  const [bookError, setBookError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const listSequence = useRef(0);
  const detailSequence = useRef(0);
  const mutationVersion = useRef(0);
  const selectedId = useRef<string | null>(null);
  const navigation = useRef<ReturnType<typeof createBookNavigation> | null>(null);
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
    setDetailLoading(false);
  }, []);

  const backToLibrary = useCallback(() => {
    navigation.current?.backToLibrary();
  }, []);

  const loadBook = useCallback(async (id: string) => {
    const sequence = ++detailSequence.current;
    setBookError(null);
    setDetailLoading(false);
    try {
      await readCurrent({
        read: () => libraryApi.getBook(id),
        isActive: () => sequence === detailSequence.current,
        version: () => mutationVersion.current,
        commit: detail => {
          setSelectedBook(detail);
          window.scrollTo({ top: 0, behavior: 'instant' });
        },
      });
    } catch (cause) {
      if (sequence === detailSequence.current) setBookError({ message: messageOf(cause), notFound: cause instanceof ApiError && cause.status === 404 });
    }
  }, []);

  useEffect(() => {
    const controller = createBookNavigation(window, id => {
      selectedId.current = id;
      setBookId(id);
      setSelectedBook(null);
      setBookError(null);
      window.scrollTo({ top: 0, behavior: 'instant' });
      if (id) void loadBook(id);
      else cancelOpening();
    });
    navigation.current = controller;
    return () => {
      controller.dispose();
      navigation.current = null;
      detailSequence.current++;
    };
  }, [loadBook, cancelOpening]);

  const openBook = useCallback((book: Book) => { navigation.current?.openBook(book.id); }, []);
  const retryBook = useCallback(() => { if (selectedId.current) void loadBook(selectedId.current); }, [loadBook]);

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
    notify('Datos actualizados');
  }

  function applyAnnotationDelete(book: BookDetail) {
    patchBook(book.id, { highlightCount: book.highlightCount, noteCount: book.noteCount, updatedAt: book.updatedAt });
    setSelectedBook(previous => previous?.id === book.id ? { ...previous, annotations: book.annotations } : previous);
    notify('Anotación eliminada');
  }

  function applyTextUpdate(annotation: Annotation, message = 'Anotación actualizada') {
    mutationVersion.current++;
    setSelectedBook(previous => previous?.id === annotation.bookId ? {
      ...previous, annotations: previous.annotations.map(item => item.id === annotation.id ? annotation : item),
    } : previous);
    notify(message);
    void loadBooks();
  }

  function removeBook(id: string) {
    mutationVersion.current++;
    setListing(previous => ({ ...previous, books: previous.books.filter(book => book.id !== id) }));
    if (selectedId.current === id) {
      navigation.current?.replaceWithLibrary();
    }
    void loadBooks();
    notify('Libro eliminado');
  }

  return {
    ...listing, query, sort, selectedBook, bookId, bookError, loading, detailLoading, loadError,
    changeQuery, changeSort, changePage,
    loadBooks, openBook, retryBook, backToLibrary, refreshAfterImport,
    applyCoverUpdate, applyMetadataUpdate, applyAnnotationDelete, applyTextUpdate, removeBook,
  };
}
