"""Nationalities: a per-guild vocabulary, plus the universal "Unknown".

Each guild keeps its own list (`nationalities`), seeded from
`DEFAULT_NATIONALITIES` when the guild is created and editable by its
maintainers. `UNKNOWN` is *not* a row: people and artists store it as NULL and
read it back as "Unknown" (`NationalityValue`), so it is always valid, can't be
renamed or removed, and is what anything created without a nationality gets.

People and artists reference the list with a composite foreign key
`(nationality, guild_id) -> nationalities(name, guild_id)` (`nationality_fks`):
Postgres refuses a value the guild doesn't have, and a rename cascades.
NULL (Unknown) skips the check.

Careful in SQL: `Person.core_nationality == UNKNOWN` binds NULL and so matches
nothing; test `.is_(None)` instead.
"""
from __future__ import annotations

from sqlalchemy import ForeignKeyConstraint, Index, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, declared_attr, mapped_column
from sqlalchemy.types import TypeDecorator

from .base import Base
from .mixins import GuildScoped, NormalizedNames

UNKNOWN = "Unknown"

#: What a new guild starts with. Everything the old fixed list had is here, so
#: existing data keeps its values.
DEFAULT_NATIONALITIES: tuple[str, ...] = (
    "Afghan", "Albanian", "Algerian", "American", "Andorran", "Angolan", "Antiguan and Barbudan", "Argentinian",
    "Armenian", "Aruban", "Australian", "Austrian", "Azerbaijani",
    "Bahamian", "Bahraini", "Bangladeshi", "Barbadian", "Basque", "Belarusian", "Belgian", "Belizean", "Beninois",
    "Bermudian", "Bhutanese", "Bissau-Guinean", "Bolivian", "Bosnian", "Botswanan", "Brazilian", "British",
    "Bruneian", "Bulgarian", "Burkinabé", "Burmese", "Burundian",
    "Cambodian", "Cameroonian", "Canadian", "Cape Verdean", "Catalan", "Central African", "Chadian",
    "Channel Islander", "Chilean", "Chinese", "Colombian", "Comoran", "Congolese", "Cook Islander", "Costa Rican",
    "Croatian", "Cuban", "Curaçaoan", "Cypriot", "Czech", "Czechoslovak",
    "Danish", "Djiboutian", "Dominican", "Dutch",
    "East German", "East Timorese", "Ecuadorian", "Egyptian", "Emirati", "English", "Equatorial Guinean",
    "Eritrean", "Estonian", "Ethiopian",
    "Faroese", "Fijian", "Filipino", "Finnish", "French",
    "Gabonese", "Gambian", "Georgian", "German", "Ghanaian", "Gibraltarian", "Greek", "Greenlandic", "Grenadian",
    "Guatemalan", "Guinean", "Guyanese",
    "Haitian", "Honduran", "Hongkongese", "Hungarian",
    "Icelandic", "Indian", "Indonesian", "Iranian", "Iraqi", "Irish", "Israeli", "Italian", "Ivorian",
    "Jamaican", "Japanese", "Jordanian",
    "Kazakh", "Kenyan", "Kiribati", "Kittitian and Nevisian", "Korean", "Kosovar", "Kurdish", "Kuwaiti", "Kyrgyz",
    "Laotian", "Latvian", "Lebanese", "Liberian", "Libyan", "Liechtensteiner", "Lithuanian", "Luxembourgish",
    "Macanese", "Macedonian", "Malagasy", "Malawian", "Malaysian", "Maldivian", "Malian", "Maltese", "Manx",
    "Marshallese", "Mauritanian", "Mauritian", "Mexican", "Micronesian", "Moldovan", "Monégasque", "Mongolian",
    "Montenegrin", "Moroccan", "Mozambican",
    "Namibian", "Nauruan", "Nepalese", "New Zealander", "Nicaraguan", "Nigerian", "Nigerien", "North Korean",
    "Northern Irish", "Norwegian",
    "Omani",
    "Pakistani", "Palauan", "Palestinian", "Panamanian", "Papua New Guinean", "Paraguayan", "Peruvian", "Polish",
    "Portuguese", "Puerto Rican",
    "Qatari",
    "Romanian", "Russian", "Rwandan",
    "Saint Lucian", "Salvadoran", "Sammarinese", "Samoan", "São Toméan", "Saudi", "Scottish", "Senegalese",
    "Serbian", "Seychellois", "Sierra Leonean", "Singaporean", "Slovak", "Slovenian", "Solomon Islander",
    "Somalian", "South African", "South Sudanese", "Soviet", "Spanish", "Sri Lankan", "Sudanese", "Surinamese",
    "Swazi", "Swedish", "Swiss", "Syrian",
    "Tahitian", "Taiwanese", "Tajik", "Tanzanian", "Thai", "Tibetan", "Togolese", "Tongan",
    "Trinidadian and Tobagonian", "Tunisian", "Turkish", "Turkmen", "Tuvaluan",
    "Ugandan", "Ukrainian", "Uruguayan", "Uzbek",
    "Vanuatuan", "Venezuelan", "Vietnamese", "Vincentian",
    "Welsh", "West German",
    "Yemeni", "Yugoslav",
    "Zambian", "Zimbabwean",
)

#: Kept for the TMDB/IGDB guessers, which map places to these names; the
#: guess is then checked against the guild's own list (`server/nationalities.py`).
NATIONALITIES = DEFAULT_NATIONALITIES


class NationalityValue(TypeDecorator):
    """A person's/artist's nationality: NULL in the database, "Unknown" in Python."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return None if value is None or value == UNKNOWN else value

    def process_result_value(self, value, dialect):
        return UNKNOWN if value is None else value


class Nationality(GuildScoped, NormalizedNames, Base):
    __tablename__ = "nationalities"
    __table_args__ = (
        UniqueConstraint("name", "guild_id", name="uq_nationalities_name_guild"),
        # "french" and "French" are the same nationality.
        Index("uq_nationalities_guild_norm", "guild_id", "name_norm", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)


class HasNationalities:
    """`birth_nationality` / `core_nationality`. Pair with `nationality_fks()`
    in `__table_args__`. When exactly one is Unknown, the before-flush hook in
    database.py copies the other into it."""

    @declared_attr
    def birth_nationality(cls) -> Mapped[str]:
        return mapped_column(NationalityValue, nullable=True)

    @declared_attr
    def core_nationality(cls) -> Mapped[str]:
        return mapped_column(NationalityValue, nullable=True)


def nationality_fks(table: str) -> tuple[ForeignKeyConstraint, ...]:
    return tuple(
        ForeignKeyConstraint(
            [col, "guild_id"], ["nationalities.name", "nationalities.guild_id"],
            onupdate="CASCADE", name=f"fk_{table}_{col}",
        )
        for col in ("birth_nationality", "core_nationality")
    )


def fill_unknown_nationality(obj: HasNationalities) -> None:
    """If one of the two is entered and the other is Unknown, the other takes it.
    Neither given -> both Unknown (never left as a bare None in Python)."""
    birth = obj.birth_nationality or UNKNOWN
    core = obj.core_nationality or UNKNOWN
    if birth == UNKNOWN:
        birth = core
    elif core == UNKNOWN:
        core = birth
    if obj.birth_nationality != birth:
        obj.birth_nationality = birth
    if obj.core_nationality != core:
        obj.core_nationality = core
