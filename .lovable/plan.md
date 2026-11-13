# AirMileX — mevcut Paddle ile güvenli ödeme hazırlığı

## Hedef
Mevcut Paddle Billing hazırlığını koruyarak tek seferlik **9 USD karşılığında 500 kredi** satın alımını güvenle çalışır duruma getirmek. Yeni ödeme sağlayıcısı veya yeni backend oluşturulmayacak.

## Doğrulanan durum
- İncelenen kaynak sürümü: `486207f2cf383ad546458aaa2589f8f5391d8232`.
- Ödeme sayfası, checkout ve webhook dosyaları mevcut.
- Paddle ayarları henüz kayıtlı değil.
- Canlı veritabanında `fulfill_paddle_credits` işlemi bulunmuyor; kaynakta migration mevcut olması uygulanmış olduğu anlamına gelmiyor.
- Checkout kaynak kodu sunucu tarafındaki kapalı ödeme bayrağını kontrol etmiyor ve doğrudan canlı Paddle adresini kullanıyor.
- Yayımlanan işlev sürümleri ve ürün fiyatı henüz doğrulanmadı.

## Sınırlı çalışma
1. Onaylı development sürümünü ve GitHub senkronizasyonunu doğrula. Main üzerindeki mevcut çalışmayı değiştirme; otomatik dal değiştirme veya birleştirme yapma. Bu ortam development üzerinde güvenle çalışamıyorsa kod değişikliklerini Antigravity için sınırlandırılmış görev olarak teslim et.
2. Checkout için varsayılan kapalı sunucu kilidini, açık sandbox/live ayrımını ve doğrulanmış kullanıcı kimliğini uygula. Yanlış veya eksik ayarlarda ödeme oluşturma.
3. Mevcut webhook ve migration için imza, fiyat, tek adet ürün, tam +500 kredi, tekrar bildirim ve eşzamanlı işlem güvenliğini incele. Mevcut bakiyeleri koru; müşteri verileriyle test yapma.
4. Onaylı development üzerinde yerel, sahte sağlayıcı testlerini çalıştır. Gerçek fiyatın 9 USD olduğunu doğrulayacak kontrolü ekle.
5. İnceleme geçtikten sonra test Paddle anahtarı, ürün fiyat kimliği ve webhook imza anahtarını güvenli form üzerinden al. Anahtarları sohbete isteme. İlk ayarlar `PADDLE_ENVIRONMENT=sandbox` ve `PADDLE_CHECKOUT_ENABLED=false` olacak.
6. Migration ön kontrolünü sun. Veritabanı değişikliği ve işlevlerin yayına alınması için ayrı onay iste; ardından yalnız onaylanan işlemleri gerçekleştir.
7. Test ödeme akışı için ayrı izin al. Bir test satın alımının tam +500 kredi verdiğini ve tekrar bildirimin ek kredi vermediğini doğrula. Testler mevcut kullanıcıları veya finansal kayıtları etkileyebilecekse dur ve izin iste.

## Canlıya geçiş
Paddle hesap/site doğrulaması, Red Team incelemesi, owner-approved main birleştirmesi, veritabanı ve işlev onayları tamamlanmadan canlı checkout açılmaz. Canlı anahtarlar, ödeme bayrakları ve Lovable Publish ayrı açık onaylarla değiştirilir. Bu planın onayı canlı ödeme, migration, deployment, merge veya Publish onayı değildir.

## Teknik kapsam
Yalnız mevcut Paddle checkout, webhook, finansal fulfillment ve ilgili testler; ilgisiz güvenlik bulguları, harita sağlayıcıları ve diğer ürün özellikleri değiştirilmeyecek.
