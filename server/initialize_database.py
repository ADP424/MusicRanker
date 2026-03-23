from server import database

if __name__ == "__main__":
    database.init_engine()
    database.drop_all()
    database.create_all()
    database.dispose_engine()
    print("✓ schema created from ORM models")
