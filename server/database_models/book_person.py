from __future__ import annotations

from sqlalchemy import ForeignKey, ForeignKeyConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .book_role import BookRole, book_role_type


class BookPerson(Base):
    __tablename__ = "book_persons"
    __table_args__ = (
        ForeignKeyConstraint(["book_id", "guild_id"], ["books.id", "books.guild_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["person_id", "guild_id"], ["people.id", "people.guild_id"], ondelete="CASCADE"),
    )

    book_id: Mapped[int] = mapped_column(primary_key=True)
    person_id: Mapped[int] = mapped_column(primary_key=True)
    role: Mapped[BookRole] = mapped_column(book_role_type, primary_key=True)
    guild_id: Mapped[int] = mapped_column(ForeignKey("guilds.id", ondelete="CASCADE"), nullable=False, index=True)

    book = relationship("Book", back_populates="person_links", foreign_keys=[book_id])
    person = relationship("Person", back_populates="book_links", foreign_keys=[person_id])
