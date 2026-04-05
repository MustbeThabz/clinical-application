from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    app_port: int = 8010

    database_url: str = "postgresql://postgres:postgres@localhost:5432/clinical_app"
    redis_url: str = "redis://localhost:6379/0"

    whatsapp_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_business_account_id: str = ""
    whatsapp_verify_token: str = ""

    gemini_api_key: str = ""

    internal_api_token: str = "change-me"
    clinic_timezone: str = "Africa/Johannesburg"
    whatsapp_clinic_name: str = "Clinic Care Team"
    reminder_ack_wait_hours_stage1: int = 3
    reminder_ack_wait_hours_stage2: int = 3
    reminder_ack_wait_hours_after_call: int = 3
    reminder_ack_wait_hours_after_next_of_kin: int = 3
    reminder_day_of_hours_before: int = 6
    nurse_alert_phone: str = ""
    homebase_alert_phone: str = ""


settings = Settings()
