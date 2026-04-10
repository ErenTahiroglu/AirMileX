import { Link } from "react-router-dom";
import Footer from "@/components/Footer";

const PrivacyPage = () => (
  <div className="flex min-h-screen flex-col bg-background">
    <div className="flex-1 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Back to Home</Link>

        <h1 className="mt-6 text-3xl font-bold mb-8">PRIVACY POLICY / GİZLİLİK POLİTİKASI</h1>

        {/* Turkish */}
        <h2 className="text-2xl font-bold mb-4">Türkçe</h2>
        <p className="mb-1 text-sm text-muted-foreground">Son Güncelleme: 10/04/2026</p>
        <p className="mb-4 text-sm text-muted-foreground">Yürürlük Tarihi: 10/04/2026</p>
        <p className="mb-4 text-muted-foreground">Bu Gizlilik Politikası, AirMileX kullanılırken kişisel verilerin nasıl toplandığını, işlendiğini, paylaşıldığını ve korunduğunu açıklar.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">1. Veri Sorumlusu</h3>
        <p className="mb-4 text-muted-foreground">Eren Tahiroğlu<br/>AirMileX markası altında bireysel satıcı<br/>E-posta: erentahiroglu@hotmail.com.tr<br/>Yazışma Adresi: Abdullah Gül Üniversitesi Öğrenci Yurtları, Yeni, 4. Sk. No:8, 38090 Kocasinan/Kayseri, Türkiye</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">2. Kapsam</h3>
        <p className="mb-2 text-muted-foreground">Bu politika;</p>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>web sitesi ziyaretçilerine,</li>
          <li>hesap oluşturan kullanıcılara,</li>
          <li>ücretli veya ücretsiz kullanıcılarına,</li>
          <li>destek talebi gönderen kişilere,</li>
          <li>Airtable veya manuel giriş yoluyla veri aktaran kullanıcılara uygulanır.</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">3. İşlenen Veri Kategorileri</h3>
        <p className="mb-2 text-muted-foreground">AirMileX kapsamında şu veri kategorileri işlenebilir:</p>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li><strong>a) Kimlik ve hesap verileri:</strong> ad soyad, e-posta adresi, şifre veya kimlik doğrulama bilgileri, hesap tercihleri</li>
          <li><strong>b) Kullanıcı tarafından sağlanan içerikler:</strong> manuel girilen mesafe kayıtları, adres/rota bilgileri, notlar, Airtable'dan senkronize edilen içerikler</li>
          <li><strong>c) İşlem ve abonelik verileri:</strong> plan bilgisi, abonelik durumu, sipariş referansları, Paddle tarafından iletilen ödeme meta verileri</li>
          <li><strong>d) Teknik veriler:</strong> IP adresi, oturum logları, cihaz bilgileri, temel güvenlik verileri</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">4. Verilerin Toplanma Yöntemi</h3>
        <p className="mb-4 text-muted-foreground">Kişisel veriler; doğrudan sizden, hesap oluşturma süreçlerinden, destek iletişimlerinden, Paddle üzerinden gelen bilgilerden, entegrasyonlar bağlandığında ve teknik loglama/çerezler yoluyla toplanabilir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">5. İşleme Amaçları</h3>
        <p className="mb-4 text-muted-foreground">Kişisel veriler şu amaçlarla işlenebilir: hesap oluşturmak, hizmeti sunmak, Airtable bağlantılarını çalıştırmak, mesafe/rota hesaplamak, rapor oluşturmak, abonelik ve ödeme süreçlerini yürütmek, güvenlik/hata tespiti yapmak, hukuki yükümlülükleri yerine getirmek.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">6. Hukuki Sebepler</h3>
        <p className="mb-4 text-muted-foreground">Kişisel veriler; sözleşmenin ifası, hukuki yükümlülüklerin yerine getirilmesi, meşru menfaatler veya açık rıza gerektiren hallerde açık rıza dayanaklarıyla işlenebilir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">7. Kişisel Verilerin Aktarılması</h3>
        <p className="mb-4 text-muted-foreground">Kişisel veriler; Paddle, teknik altyapı/hosting sağlayıcıları, harita servisleri ve yetkili kamu kurumlarıyla paylaşılabilir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">8. Yurt Dışına Aktarım</h3>
        <p className="mb-4 text-muted-foreground">Teknik altyapı ve ödeme sağlayıcıları nedeniyle kişisel veriler Türkiye dışında bulunan sunuculara aktarılabilir. Uygun koruma mekanizmaları gözetilir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">9. Saklama Süresi</h3>
        <p className="mb-4 text-muted-foreground">Veriler; hizmetin sunulması, hesabın aktif olması, hukuki/mali saklama zorunlulukları ve güvenlik ihtiyaçları süresince saklanır. Süre sonunda silinir, yok edilir veya anonim hale getirilir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">10. Güvenlik</h3>
        <p className="mb-4 text-muted-foreground">Kişisel verilerin yetkisiz erişim veya kayba karşı korunması için makul tedbirler alınır. Ancak internet üzerinden hiçbir sistem mutlak güvenlik garantisi vermez.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">11. İlgili Kişi Hakları</h3>
        <p className="mb-4 text-muted-foreground">Uygulanabilir mevzuat kapsamında ilgili kişiler; veri işlenip işlenmediğini öğrenme, düzeltme, silme talep etme, aktarılan üçüncü kişileri öğrenme ve itiraz etme haklarına sahiptir. Başvuru: erentahiroglu@hotmail.com.tr</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">12. Çerezler</h3>
        <p className="mb-4 text-muted-foreground">AirMileX, teknik olarak gerekli çerezler kullanır. Analitik/pazarlama çerezleri kullanılırsa ayrı bir bilgilendirme/onay mekanizması sunulur.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">13. 18 Yaş Altı</h3>
        <p className="mb-4 text-muted-foreground">AirMileX, 18 yaş altına yönelik değildir ve çocuklardan veri toplama amaçlanmamaktadır.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">14. Değişiklikler</h3>
        <p className="mb-4 text-muted-foreground">Bu politika güncellenebilir. Güncel sürüm web sitesinde yayımlandığında geçerli olur.</p>

        <hr className="my-10 border-border" />

        {/* English */}
        <h2 className="text-2xl font-bold mb-4">English</h2>
        <p className="mb-1 text-sm text-muted-foreground">Last Updated: 10/04/2026</p>
        <p className="mb-4 text-sm text-muted-foreground">Effective Date: 10/04/2026</p>
        <p className="mb-4 text-muted-foreground">This Privacy Policy explains how personal data is collected, used, shared, and protected when using AirMileX.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">1. Data Controller</h3>
        <p className="mb-4 text-muted-foreground">Eren Tahiroğlu<br/>Individual seller operating under the AirMileX brand<br/>Email: erentahiroglu@hotmail.com.tr<br/>Correspondence Address: Abdullah Gül Üniversitesi Öğrenci Yurtları, Yeni, 4. Sk. No:8, 38090 Kocasinan/Kayseri, Türkiye</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">2. Scope</h3>
        <p className="mb-4 text-muted-foreground">This Policy applies to website visitors, users who create an account, paid/free users, support requesters, and users transferring data via Airtable or manual input.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">3. Categories of Data Processed</h3>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li><strong>a) Identity and account data:</strong> full name, email, password, account preferences.</li>
          <li><strong>b) User-provided content:</strong> mileage records, route info, notes, synced Airtable content.</li>
          <li><strong>c) Transaction and subscription data:</strong> plan info, subscription status, Paddle billing metadata.</li>
          <li><strong>d) Technical data:</strong> IP address, logs, device info, security data.</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">4. How Data Is Collected</h3>
        <p className="mb-4 text-muted-foreground">Data is collected directly from you, during account creation, via Paddle transactions, when connecting integrations, and through technical logging/cookies.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">5. Purposes of Processing</h3>
        <p className="mb-4 text-muted-foreground">To manage accounts, provide the service, operate Airtable connections, calculate distances, provide reporting, manage subscriptions/billing, ensure security, and comply with legal obligations.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">6. Legal Grounds</h3>
        <p className="mb-4 text-muted-foreground">Processing is based on necessity for a contract, compliance with legal obligations, legitimate interests, or explicit consent where required.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">7. Sharing of Personal Data</h3>
        <p className="mb-4 text-muted-foreground">Data may be shared with Paddle, hosting/database providers, mapping providers, and public authorities where legally required.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">8. International Transfers</h3>
        <p className="mb-4 text-muted-foreground">Data may be transferred to servers outside Türkiye due to technical infrastructure. Appropriate safeguards will be used.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">9. Retention</h3>
        <p className="mb-4 text-muted-foreground">Data is retained as long as necessary to provide the service, while your account is active, or for legal/tax obligations.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">10. Security</h3>
        <p className="mb-4 text-muted-foreground">Reasonable measures are used to protect data, though absolute internet security cannot be guaranteed.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">11. Data Subject Rights</h3>
        <p className="mb-4 text-muted-foreground">Individuals have rights to access, correct, delete their data, learn third parties, and object to processing. Contact: erentahiroglu@hotmail.com.tr</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">12. Cookies</h3>
        <p className="mb-4 text-muted-foreground">AirMileX uses technically necessary cookies. If marketing cookies are used, a separate notice and consent mechanism will be provided.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">13. Under 18</h3>
        <p className="mb-4 text-muted-foreground">AirMileX is not intended for individuals under 18.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">14. Changes</h3>
        <p className="mb-4 text-muted-foreground">This Policy may be updated. The current version is effective upon website publication.</p>
      </div>
    </div>
    <Footer />
  </div>
);

export default PrivacyPage;
