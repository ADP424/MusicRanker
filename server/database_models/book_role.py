import enum

from sqlalchemy import Enum


class BookRole(str, enum.Enum):
    """A person's credit on a book: its author(s), or a contributor (co-writer,
    illustrator, translator, editor…)."""

    author = "author"
    contributor = "contributor"


book_role_type = Enum(BookRole, name="book_role")
