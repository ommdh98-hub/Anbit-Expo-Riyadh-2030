"""One-time, interactive, local setup: python -m app.setup_accounts"""
from getpass import getpass
from sqlmodel import SQLModel
from .auth import install_account
from .database import engine


def main():
    print("تهيئة حسابات أنبت المحلية (لن تظهر كلمات المرور على الشاشة).")
    SQLModel.metadata.create_all(engine)
    for username, title in [("user", "الأفراد"), ("survey", "فرق المسطحات الخضراء")]:
        while True:
            secret = getpass(f"كلمة مرور {title} (10 أحرف على الأقل): ")
            again = getpass("تأكيد كلمة المرور: ")
            if secret != again:
                print("كلمتا المرور غير متطابقتين. حاول مرة ثانية.")
                continue
            try:
                install_account(engine, username, secret)
                print(f"تم تجهيز حساب {title}: {username}")
                break
            except ValueError as exc:
                print(exc)
    print("تم تجهيز الحسابين. تسجيل الدخول متاح من الصفحة الرئيسية. لا تشارك كلمات المرور علنًا.")


if __name__ == "__main__":
    main()
