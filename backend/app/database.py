from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker


DATABASE_URL = "sqlite:///./turnos_historial.db"

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
        patient_columns = {column["name"] for column in inspector.get_columns("patients")}
        if "prescribed_sessions" not in patient_columns:
            connection.execute(
                text("ALTER TABLE patients ADD COLUMN prescribed_sessions INTEGER NOT NULL DEFAULT 0")
            )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
