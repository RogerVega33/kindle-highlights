export type AnnotationKind = 'highlight' | 'note';
export type HighlightColor = 'yellow' | 'blue' | 'pink' | 'orange' | null;
export type BookSort = 'recent' | 'title' | 'author';

export interface BookListQuery {
  page?: number;
  query?: string;
  sort?: BookSort;
}

export interface HealthResponse {
  storage: 'postgres';
}

export interface User {
  id: string;
  username: string;
  lastLoginAt: string | null;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface RecoveryCredentials extends Credentials {
  recoveryPhrase: string;
}

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
}

export interface SessionResponse {
  user: User | null;
}

export interface RecoverySessionResponse extends SessionResponse {
  recoveryPhrase: string;
}

export interface Annotation {
  id: string;
  bookId: string;
  kind: AnnotationKind;
  text: string | null;
  originalText: string | null;
  edited: boolean;
  page: number | null;
  location: number | null;
  color: HighlightColor;
  sectionTitle: string | null;
  chapterTitle: string | null;
  sourceOrder: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  highlightCount: number;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BookDetail extends Book {
  annotations: Annotation[];
}

export interface RandomAnnotation {
  book: Pick<Book, 'id' | 'title' | 'author'>;
  annotation: Annotation;
}

export interface RandomAnnotationResponse {
  selection: RandomAnnotation | null;
}

export interface ImportIssue {
  entry: number;
  message: string;
}

export interface ImportResult {
  filename: string;
  bookId: string | null;
  bookTitle: string | null;
  status: 'success' | 'error';
  added: number;
  repeated: number;
  incomplete: number;
  highlights: number;
  notes: number;
  issues: ImportIssue[];
  error?: string;
}

export interface ImportFile {
  filename: string;
  html: string;
}

export interface UpdateBookInput {
  title: string;
  author: string;
}

export interface UpdateAnnotationInput {
  text: string;
}

export interface SetCoverInput {
  dataUrl: string;
}

export interface BooksResponse {
  books: Book[];
  page: number;
  pageSize: number;
  totalBooks: number;
  totalAnnotations: number;
  matchingBooks: number;
  totalPages: number;
}

export interface ImportRequest {
  files: ImportFile[];
  bookId?: string;
}

export interface ImportResponse {
  results: ImportResult[];
}

export interface DeleteBookResponse {
  deletedBookId: string;
}

export interface ApiError {
  message: string;
}
