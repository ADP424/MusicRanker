"""Per-guild nationalities: seeding, the always-present Unknown, filling the
other nationality, rename/delete propagation, and guild isolation."""


def _nats(client, guild):
    r = client.get(f"/guilds/{guild}/nationalities")
    assert r.status_code == 200, r.text
    return {n["name"]: n for n in r.json()}


def _person(client, guild, **body):
    r = client.post(f"/guilds/{guild}/persons", json={"name": "Someone", **body})
    assert r.status_code == 201, r.text
    return r.json()


def test_new_guild_gets_defaults_without_unknown(make_user):
    alice, _, guild = make_user("alice")
    nats = _nats(alice, guild)
    assert len(nats) > 150 and "French" in nats and "Yugoslav" in nats
    assert "Unknown" not in nats


def test_unknown_by_default_and_other_filled_in(make_user):
    alice, _, guild = make_user("alice")
    p = _person(alice, guild)
    assert (p["birth_nationality"], p["core_nationality"]) == ("Unknown", "Unknown")

    p = _person(alice, guild, birth_nationality="French")
    assert p["core_nationality"] == "French"
    p = _person(alice, guild, core_nationality="Irish")
    assert p["birth_nationality"] == "Irish"
    p = _person(alice, guild, birth_nationality="Irish", core_nationality="French")
    assert (p["birth_nationality"], p["core_nationality"]) == ("Irish", "French")

    # Entering one later fills the other too.
    pid = _person(alice, guild)["id"]
    r = alice.patch(f"/guilds/{guild}/persons/{pid}", json={"core_nationality": "Welsh"})
    assert r.json()["birth_nationality"] == "Welsh"

    r = alice.post(f"/guilds/{guild}/artists", json={"name": "Band", "core_nationality": "Swedish"})
    assert r.status_code == 201, r.text
    assert r.json()["birth_nationality"] == "Swedish"


def test_unrelated_edit_leaves_a_lone_unknown(make_user):
    alice, _, guild = make_user("alice")
    p = _person(alice, guild, birth_nationality="Irish", core_nationality="French")
    alice.patch(f"/guilds/{guild}/persons/{p['id']}", json={"birth_nationality": "Unknown"})
    # Setting one to Unknown explicitly is itself an entry: it takes the other.
    r = alice.get(f"/guilds/{guild}/persons/{p['id']}").json()
    assert r["birth_nationality"] == "French"


def test_unknown_cannot_be_added_or_renamed_to(make_user):
    alice, _, guild = make_user("alice")
    assert alice.post(f"/guilds/{guild}/nationalities", json={"name": " unknown "}).status_code == 422
    nid = _nats(alice, guild)["French"]["id"]
    assert alice.patch(f"/guilds/{guild}/nationalities/{nid}", json={"name": "Unknown"}).status_code == 422
    # Case-insensitive duplicates are refused.
    assert alice.post(f"/guilds/{guild}/nationalities", json={"name": "french"}).status_code == 409


def test_value_not_in_the_guild_is_refused(make_user):
    alice, _, guild = make_user("alice")
    r = alice.post(f"/guilds/{guild}/persons", json={"name": "X", "birth_nationality": "Atlantean"})
    assert r.status_code == 409
    assert alice.post(f"/guilds/{guild}/nationalities", json={"name": "Atlantean"}).status_code == 201
    assert _person(alice, guild, birth_nationality="Atlantean")["core_nationality"] == "Atlantean"


def test_rename_and_delete_propagate(make_user):
    alice, _, guild = make_user("alice")
    a = _person(alice, guild, birth_nationality="Irish", core_nationality="French")
    b = _person(alice, guild, birth_nationality="French")
    nats = _nats(alice, guild)
    assert nats["French"]["people_count"] == 2

    r = alice.patch(f"/guilds/{guild}/nationalities/{nats['French']['id']}", json={"name": "Français"})
    assert r.status_code == 200 and r.json()["people_count"] == 2
    assert alice.get(f"/guilds/{guild}/persons/{a['id']}").json()["core_nationality"] == "Français"

    assert alice.delete(f"/guilds/{guild}/nationalities/{nats['French']['id']}").status_code == 204
    a2 = alice.get(f"/guilds/{guild}/persons/{a['id']}").json()
    b2 = alice.get(f"/guilds/{guild}/persons/{b['id']}").json()
    assert (a2["birth_nationality"], a2["core_nationality"]) == ("Irish", "Irish")  # fell back to the other
    assert (b2["birth_nationality"], b2["core_nationality"]) == ("Unknown", "Unknown")


def test_guilds_lists_are_independent(make_user):
    alice, _, ga = make_user("alice")
    bob, _, gb = make_user("bob")
    alice.post(f"/guilds/{ga}/nationalities", json={"name": "Atlantean"})
    assert "Atlantean" in _nats(alice, ga) and "Atlantean" not in _nats(bob, gb)
    r = bob.post(f"/guilds/{gb}/persons", json={"name": "X", "birth_nationality": "Atlantean"})
    assert r.status_code == 409
