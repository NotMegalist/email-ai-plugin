"""
E-Posta Sınıflandırma Modeli Eğitimi
Gerçek Veri Kümeleri kullanılarak TF-IDF + Makine Öğrenmesi
Kategoriler: Normal (0), Önemli (1), Spam (2), Oltalama (3)

Kullanım:
    python train_model.py
"""

import os
import sys
import pickle
import json
import urllib.request
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
import re
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Çıktı dosya yolları
MODEL_DIR = os.path.dirname(__file__)
MODEL_PATH = os.path.join(MODEL_DIR, 'email_classifier.pkl')
VECTORIZER_PATH = os.path.join(MODEL_DIR, 'tfidf_vectorizer.pkl')
METRICS_PATH = os.path.join(MODEL_DIR, 'metrics.json')


def preprocess_text(text: str) -> str:
    """E-posta metnini temizle"""
    if not isinstance(text, str) or not text:
        return ""
    text = text.lower()
    
    # Türkçe karakterleri İngilizce karşılıklarına dönüştür (kelime bölünmelerini önler)
    tr_map = {
        'ı': 'i', 'ğ': 'g', 'ü': 'u', 'ş': 's', 'ö': 'o', 'ç': 'c'
    }
    for tr, en in tr_map.items():
        text = text.replace(tr, en)
        
    text = re.sub(r'http\S+|www\S+', 'URL', text)
    text = re.sub(r'\S+@\S+', 'EMAIL', text)
    text = re.sub(r'[^a-zA-Z0-9\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def download_file(url: str, dest_path: str):
    """URL'den dosya indir"""
    if os.path.exists(dest_path):
        logger.info(f"Dosya zaten mevcut: {dest_path}")
        return
    logger.info(f"Dosya indiriliyor: {url} -> {dest_path}")
    try:
        urllib.request.urlretrieve(url, dest_path)
        logger.info("İndirme tamamlandı.")
    except Exception as e:
        logger.error(f"İndirme hatası: {e}")
        raise e


def load_and_combine_datasets() -> pd.DataFrame:
    """
    Gerçek veri kümelerini internetten indir ve birleştir:
    1. Phishing_Email.csv (Safe Email / Phishing Email)
    2. spam.csv (Spam messages)
    """
    phishing_csv_path = os.path.join(MODEL_DIR, 'Phishing_Email.csv')
    spam_csv_path = os.path.join(MODEL_DIR, 'spam_sms.csv')
    
    # 1. Veri Kümelerini İndir
    phishing_url = "https://raw.githubusercontent.com/uzmabb182/Data_622/refs/heads/main/final_project_data_622/Phishing_Email.csv"
    spam_url = "https://raw.githubusercontent.com/codebasics/nlp-tutorials/refs/heads/main/9_bag_of_words/spam.csv"
    
    download_file(phishing_url, phishing_csv_path)
    download_file(spam_url, spam_csv_path)
    
    # 2. Phishing_Email.csv Yükle ve Ön İşle
    logger.info("Phishing_Email.csv yükleniyor...")
    df_phish = pd.read_csv(phishing_csv_path, encoding='latin-1')
    df_phish = df_phish.dropna(subset=['Email Text', 'Email Type'])
    df_phish = df_phish.rename(columns={'Email Text': 'text', 'Email Type': 'type'})
    
    # Varsayılan Etiketleme: Safe Email -> Normal (0), Phishing Email -> Oltalama (3)
    df_phish['label'] = df_phish['type'].map({'Safe Email': 0, 'Phishing Email': 3}).fillna(0).astype(int)
    
    # Önemli E-posta tespiti (Safe Email olanlar arasından)
    important_keywords = ['urgent', 'deadline', 'invoice', 'meeting', 'payment due',
                           'action required', 'reminder', 'important', 'schedule', 'action', 'review']
    
    def detect_important(text):
        if not isinstance(text, str):
            return False
        text_lower = text.lower()
        matches = sum(1 for kw in important_keywords if kw in text_lower)
        return matches >= 1
    
    important_mask = df_phish['text'].apply(detect_important) & (df_phish['label'] == 0)
    df_phish.loc[important_mask, 'label'] = 1  # Önemli
    
    # 3. spam_sms.csv Yükle (Sadece Spam olanları ekle)
    logger.info("spam_sms.csv yükleniyor...")
    df_spam = pd.read_csv(spam_csv_path, encoding='latin-1')
    df_spam = df_spam.dropna(subset=['Message', 'Category'])
    df_spam = df_spam.rename(columns={'Message': 'text', 'Category': 'type'})
    
    # Sadece spam olanları filtrele
    df_spam_only = df_spam[df_spam['type'] == 'spam'].copy()
    df_spam_only['label'] = 2  # Spam
    
    # 4. Birleştir
    logger.info("Veri kümeleri birleştiriliyor...")
    df_combined = pd.concat([
        df_phish[['text', 'label']],
        df_spam_only[['text', 'label']]
    ], ignore_index=True)
    
    category_names = {0: 'Normal', 1: 'Önemli', 2: 'Spam', 3: 'Oltalama'}
    df_combined['category'] = df_combined['label'].map(category_names)
    
    # Karıştır
    df_combined = df_combined.sample(frac=1, random_state=42).reset_index(drop=True)
    return df_combined


def train_and_evaluate(df: pd.DataFrame) -> None:
    """Model eğitimi, değerlendirmesi ve metriklerin kaydedilmesi"""
    
    logger.info("=== E-Posta Sınıflandırma Modeli Eğitimi ===")
    logger.info(f"Toplam örnek sayısı: {len(df)}")
    logger.info(f"Kategori dağılımı:\n{df['category'].value_counts()}")
    
    # Metinleri ön işle
    logger.info("Metinler ön işleniyor...")
    df['processed_text'] = df['text'].apply(preprocess_text)
    
    X = df['processed_text']
    y = df['label']
    
    # Eğitim/test bölme (%80/%20)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    logger.info(f"Eğitim seti: {len(X_train)}, Test seti: {len(X_test)}")
    
    # TF-IDF Vectorizer
    logger.info("TF-IDF vectorizer oluşturuluyor...")
    vectorizer = TfidfVectorizer(
        max_features=15000,
        ngram_range=(1, 2),
        stop_words='english',
        sublinear_tf=True,
        min_df=2
    )
    
    X_train_tfidf = vectorizer.fit_transform(X_train)
    X_test_tfidf = vectorizer.transform(X_test)
    
    # Multinomial Naive Bayes modeli
    logger.info("Multinomial Naive Bayes modeli eğitiliyor...")
    model = MultinomialNB(alpha=0.1)
    model.fit(X_train_tfidf, y_train)
    
    # Test değerlendirmesi
    y_pred = model.predict(X_test_tfidf)
    accuracy = accuracy_score(y_test, y_pred)
    
    logger.info(f"\n=== MODEL SONUÇLARI ===")
    logger.info(f"Genel Doğruluk: {accuracy:.4f} ({accuracy*100:.2f}%)")
    
    target_names = ['Normal', 'Önemli', 'Spam', 'Oltalama']
    report_dict = classification_report(y_test, y_pred, target_names=target_names, zero_division=0, output_dict=True)
    report_str = classification_report(y_test, y_pred, target_names=target_names, zero_division=0)
    logger.info(f"\nSınıf bazlı rapor:\n{report_str}")
    
    # Karışıklık matrisi
    cm = confusion_matrix(y_test, y_pred)
    logger.info(f"\nKarışıklık Matrisi:\n{cm}")
    
    # Cross-validation
    logger.info("5-Fold Cross-Validation yapılıyor...")
    X_all_tfidf = vectorizer.transform(X)
    cv_scores = cross_val_score(model, X_all_tfidf, y, cv=5, scoring='accuracy')
    logger.info(f"CV Skorları: {cv_scores}")
    logger.info(f"CV Ortalama: {cv_scores.mean():.4f} (+/- {cv_scores.std()*2:.4f})")
    
    # Eğitim sonuçlarından hesaplanan gerçek metrikleri kaydet
    metrics = {
        'accuracy': round(float(accuracy), 4),
        'cv_mean': round(float(cv_scores.mean()), 4),
        'cv_std': round(float(cv_scores.std()), 4),
        'confusion_matrix': cm.tolist(),
        'classification_report': {
            name: {k: round(v, 2) for k, v in vals.items()}
            for name, vals in report_dict.items()
            if name in target_names
        },
        'sample_sizes': df['category'].value_counts().to_dict()
    }
    
    with open(METRICS_PATH, 'w', encoding='utf-8') as f:
        json.dump(metrics, f, indent=4, ensure_ascii=False)
    logger.info(f"Metrikler kaydedildi: {METRICS_PATH}")
    
    # Model kaydet
    logger.info(f"Model kaydediliyor: {MODEL_PATH}")
    with open(MODEL_PATH, 'wb') as f:
        pickle.dump(model, f)
    
    logger.info(f"Vectorizer kaydediliyor: {VECTORIZER_PATH}")
    with open(VECTORIZER_PATH, 'wb') as f:
        pickle.dump(vectorizer, f)
    
    logger.info("✓ Model eğitimi tamamlandı!")


def main():
    df = load_and_combine_datasets()
    train_and_evaluate(df)


if __name__ == '__main__':
    main()
