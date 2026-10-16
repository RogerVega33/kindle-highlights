import type { Book } from '../../../shared/types';
import { libraryApi } from '../../api/library';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';

export function DeleteBookDialog({ book, onClose, onDeleted }: {
  book: Book;
  onClose: () => void;
  onDeleted: (bookId: string) => void;
}) {
  return (
    <ConfirmationDialog
      title="Eliminar libro"
      description={'¿Quieres eliminar «' + book.title + '»? Se eliminarán también su portada, subrayados y notas.'}
      onClose={onClose}
      className="delete-book-modal"
      onConfirm={async () => {
        await libraryApi.deleteBook(book.id);
        onDeleted(book.id);
      }}
    />
  );
}
