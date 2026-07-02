from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Document Autofill API"
    app_env: str = "development"
    storage_root: str = "storage"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost"]

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
