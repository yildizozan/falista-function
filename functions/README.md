# Coffee Fortune Telling Function

Bu Firebase Cloud Function, `/coffee` koleksiyonundaki dokümanları kullanıcı bilgileriyle birlikte Gemini AI'ya gönderir ve kahve falı yorumu alır.

## Kurulum

1. Gemini API key'inizi alın: https://makersuite.google.com/app/apikey

2. Environment variable'ı ayarlayın:
   ```bash
   export GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
   ```

3. Gerekli paketleri yükleyin:
   ```bash
   npm install
   ```

4. Function'ı deploy edin:
   ```bash
   npm run deploy
   ```

## Nasıl Çalışır

1. `/coffee` koleksiyonuna yeni bir doküman eklendiğinde function tetiklenir.

2. Kullanıcı bilgileri ve fotoğraflar Gemini AI'ya gönderilir.

3. Gemini'den gelen kahve falı yorumu aynı dokümanda `result` alanına kaydedilir.

## Örnek Doküman Formatı

Coffee koleksiyonuna şu şekilde bir doküman ekleyin:

```json
{
  "userName": "Ahmet",
  "userBirthday": "1990-05-15",
  "userRelationStatus": "evli",
  "userEmploymentStatus": "mühendis",
  "photoPaths": [
    "coffee-images/cup1.jpg",
    "coffee-images/cup2.jpg"
  ]
}
```

Function çalıştıktan sonra doküman şu şekilde güncellenecek:

```json
{
  "userName": "Ahmet",
  "userBirthday": "1990-05-15",
  "userRelationStatus": "evli", 
  "userEmploymentStatus": "mühendis",
  "photoPaths": [...],
  "status": "completed",
  "result": {
    "analysis": "Gemini AI'dan gelen kahve falı yorumu...",
    "processedAt": "2025-08-28T10:30:00.000Z",
    "source": "gemini-2.0-flash-001"
  }
}
```

## Gerekli Alanlar

- `userName`: Kullanıcı adı
- `userBirthday`: Doğum tarihi
- `userRelationStatus`: Medeni durum
- `userEmploymentStatus`: İş durumu
- `photoPaths`: Firebase Storage'daki kahve fincan fotoğraf yolları (opsiyonel)

## Firebase Storage Kullanımı

Fotoğrafları Firebase Storage'a yükleyin ve path'lerini `photoPaths` alanına ekleyin:

```javascript
// Örnek storage path'leri
"photoPaths": [
  "coffee-images/user123/cup1.jpg",
  "coffee-images/user123/cup2.jpg"
]
```

Function otomatik olarak bu path'lerden dosyaları download edip Gemini AI'ya gönderecek.

## Function'ı İzlemek İçin

```bash
firebase functions:log --only processCoffeeWithGemini
```
