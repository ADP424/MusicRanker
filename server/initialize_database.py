from server.database import init_engine, drop_all, create_all, dispose_engine

if __name__ == "__main__":
    init_engine()
    drop_all()
    create_all()
    dispose_engine()
    print("✓ schema created from ORM models")
