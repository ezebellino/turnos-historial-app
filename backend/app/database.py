import os
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker


DATA_DIR = Path(os.getenv("TURNOS_DATA_DIR", ".")).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = f"sqlite:///{(DATA_DIR / 'turnos_historial.db').as_posix()}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def init_db():
    Base.metadata.create_all(bind=engine)

    with engine.begin() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())

        patient_columns = {column["name"] for column in inspector.get_columns("patients")}
        if "prescribed_sessions" not in patient_columns:
            connection.execute(
                text("ALTER TABLE patients ADD COLUMN prescribed_sessions INTEGER NOT NULL DEFAULT 0")
            )
        if "photo_filename" not in patient_columns:
            connection.execute(text("ALTER TABLE patients ADD COLUMN photo_filename VARCHAR(255)"))
        if "users" not in table_names:
            Base.metadata.create_all(bind=engine)
        else:
            user_columns = {column["name"] for column in inspector.get_columns("users")}
            if "phone" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN phone VARCHAR(40)"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
