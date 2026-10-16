-- Esquema completo para una instalación nueva de Kindle highlights.
-- El servidor lo aplica automáticamente si no hay tablas, vistas ni secuencias de usuario.
-- La transacción y el bloqueo de inicialización pertenecen a server/db/schema.ts.
-- No borra ni actualiza tablas existentes.

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username varchar(50) NOT NULL,
    password_hash text NOT NULL,
    recovery_phrase_hash text,
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_username_valid CHECK (
        username = btrim(username) AND char_length(username) > 0
    ),
    CONSTRAINT users_password_hash_nonempty CHECK (
        btrim(password_hash) <> ''
    ),
    CONSTRAINT users_recovery_phrase_hash_valid CHECK (
        recovery_phrase_hash IS NULL OR recovery_phrase_hash ~ '^scrypt\$65536\$8\$2\$[0-9a-f]{32}\$[0-9a-f]{128}$'
    )
);

CREATE UNIQUE INDEX users_username_unique ON users (lower(username));

CREATE TABLE sessions (
    token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz NOT NULL,
    CONSTRAINT sessions_expiration_valid CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiration_idx ON sessions(expires_at);

CREATE TABLE books (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title text NOT NULL,
    author text NOT NULL DEFAULT '',
    original_title text NOT NULL,
    original_author text NOT NULL,
    identity_hash char(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT books_title_nonempty CHECK (btrim(title) <> ''),
    CONSTRAINT books_original_title_nonempty CHECK (btrim(original_title) <> ''),
    CONSTRAINT books_original_author_nonempty CHECK (btrim(original_author) <> ''),
    CONSTRAINT books_identity_hash_valid CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT books_user_identity_unique UNIQUE (user_id, identity_hash)
);

CREATE INDEX books_user_updated_at_idx ON books (user_id, updated_at DESC, id);

CREATE TABLE annotations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    kind text NOT NULL,
    original_text text NOT NULL,
    edited_text text,
    page bigint,
    location bigint,
    color text,
    section_title text,
    chapter_title text,
    source_order integer NOT NULL,
    insertion_order bigint GENERATED ALWAYS AS IDENTITY,
    fingerprint char(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT annotations_kind_valid CHECK (kind IN ('highlight', 'note')),
    CONSTRAINT annotations_original_text_nonempty CHECK (btrim(original_text) <> ''),
    CONSTRAINT annotations_edited_text_valid CHECK (
        edited_text IS NULL OR (btrim(edited_text) <> '' AND edited_text <> original_text)
    ),
    CONSTRAINT annotations_page_valid CHECK (page BETWEEN 1 AND 9007199254740991),
    CONSTRAINT annotations_location_valid CHECK (location BETWEEN 1 AND 9007199254740991),
    CONSTRAINT annotations_locator_required CHECK (page IS NOT NULL OR location IS NOT NULL),
    CONSTRAINT annotations_color_valid CHECK (color IN ('yellow', 'blue', 'pink', 'orange')),
    CONSTRAINT annotations_source_order_positive CHECK (source_order > 0),
    CONSTRAINT annotations_fingerprint_valid CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT annotations_book_fingerprint_unique UNIQUE (book_id, fingerprint)
);

CREATE INDEX annotations_book_insertion_order_idx ON annotations (book_id, insertion_order);

CREATE TABLE book_covers (
    book_id uuid PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    data bytea NOT NULL,
    mime_type text NOT NULL,
    version uuid NOT NULL DEFAULT gen_random_uuid(),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT book_covers_size_valid CHECK (octet_length(data) BETWEEN 1 AND 5242880),
    CONSTRAINT book_covers_mime_type_valid CHECK (
        mime_type IN ('image/png', 'image/jpeg', 'image/webp')
    )
);
