import { Link } from "react-router-dom";
import Footer from "@/components/Footer";

const RefundPage = () => (
  <div className="flex min-h-screen flex-col bg-background">
    <div className="flex-1 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Back to Home</Link>

        <h1 className="mt-6 text-3xl font-bold mb-8">REFUND POLICY / İADE POLİTİKASI</h1>

        {/* Turkish */}
        <h2 className="text-2xl font-bold mb-4">Türkçe</h2>
        <p className="mb-1 text-sm text-muted-foreground">Son Güncelleme: 10/04/2026</p>
        <p className="mb-4 text-sm text-muted-foreground">Yürürlük Tarihi: 10/04/2026</p>
        <p className="mb-4 text-muted-foreground">Bu İade Politikası, AirMileX için yapılan satın alma ve abonelik ödemelerine ilişkin iade kurallarını açıklar.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">1. Ödeme Sağlayıcısı</h3>
        <p className="mb-4 text-muted-foreground">AirMileX ödemeleri Paddle üzerinden işlenir. Paddle, ilgili işlem bakımından Merchant of Record olarak hareket edebilir. Onaylanan iadeler, uygun olduğu ölçüde orijinal ödeme yöntemi üzerinden işlenir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">2. 30 Günlük Money-Back Guarantee</h3>
        <p className="mb-4 text-muted-foreground">AirMileX, ticari politika olarak uygun satın alımlar için 30 günlük para iade garantisi sunar. Kötüye kullanım bulunmadıkça, tahsilat tarihinden itibaren 30 takvim günü içinde yapılan iade talepleri değerlendirilebilir. Bu vaat zorunlu tüketici haklarını sınırlamaz.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">3. Abonelik İptali</h3>
        <p className="mb-4 text-muted-foreground">Aboneliğinizi istediğiniz zaman iptal edebilirsiniz. İptal, faturalama döneminin sonunda yürürlüğe girer ve gelecekteki tahsilatı durdurur. İptal ile iade aynı şey değildir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">4. İadenin Uygun Olduğu Haller</h3>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>ilk ücretlendirmeden itibaren 30 gün içinde yapılan başvurular,</li>
          <li>yanlışlıkla veya çift tahsilat yapılması,</li>
          <li>hizmetin esaslı kullanımını engelleyen AirMileX kaynaklı ciddi bir teknik sorunun çözülememesi,</li>
          <li>hukuken veya Paddle süreçleri uyarınca iadenin zorunlu olması.</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">5. İadenin Uygun Olmadığı Haller</h3>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>30 günlük sürenin geçmesinden sonra yapılan talepler,</li>
          <li>sahtecilik, chargeback istismarı veya politika manipülasyonu,</li>
          <li>kullanıcının kendi Airtable hesabı, API anahtarı veya bağlantı sorunlarından kaynaklanan durumlar.</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">6. Başvuru Nasıl Yapılır</h3>
        <p className="mb-4 text-muted-foreground">İade talebi için erentahiroglu@hotmail.com.tr adresine; ad soyad, satın alma e-postası, işlem/sipariş bilgisi, tarih ve iade gerekçesi iletilmelidir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">7. İnceleme ve İşleme Süresi</h3>
        <p className="mb-4 text-muted-foreground">Makul ölçüde 5 iş günü içinde ilk yanıt, 10 iş günü içinde değerlendirme hedeflenir.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">8. Zorunlu Tüketici Hakları</h3>
        <p className="mb-4 text-muted-foreground">Türkiye'de tüketiciler için mesafeli sözleşmeler bakımından kural olarak 14 günlük cayma hakkı bulunur. Bu politika zorunlu hakları sınırlamaz.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">9. Chargeback</h3>
        <p className="mb-4 text-muted-foreground">Önce sorunu bizimle çözmeye çalışmanız beklenir. Chargeback başlatılması halinde işlem bilgileri Paddle ve ödeme kuruluşlarına sunulabilir.</p>

        <hr className="my-10 border-border" />

        {/* English */}
        <h2 className="text-2xl font-bold mb-4">English</h2>
        <p className="mb-1 text-sm text-muted-foreground">Last Updated: 10/04/2026</p>
        <p className="mb-4 text-sm text-muted-foreground">Effective Date: 10/04/2026</p>
        <p className="mb-4 text-muted-foreground">This Refund Policy explains the refund rules for purchases and subscriptions made for AirMileX.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">1. Payment Provider</h3>
        <p className="mb-4 text-muted-foreground">Payments are processed through Paddle. Approved refunds will, where applicable, be returned through the original payment method.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">2. 30-Day Money-Back Guarantee</h3>
        <p className="mb-4 text-muted-foreground">AirMileX offers a 30-day money-back guarantee for eligible purchases. Unless abuse or fraud applies, requests made within 30 days of the charge date may be considered.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">3. Subscription Cancellation</h3>
        <p className="mb-4 text-muted-foreground">You may cancel at any time. Cancellation takes effect at the end of the billing period and stops future billing. Cancellation is not the same as a refund.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">4. Situations Where a Refund May Be Granted</h3>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>eligible requests made within 30 days of the initial charge,</li>
          <li>incorrect or duplicate charges,</li>
          <li>serious technical issues caused by AirMileX preventing core use,</li>
          <li>where required by mandatory law or Paddle processes.</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">5. Situations Where a Refund May Be Refused</h3>
        <ul className="list-disc pl-6 mb-4 text-muted-foreground">
          <li>requests made after 30 days,</li>
          <li>fraud, chargeback abuse, or policy manipulation,</li>
          <li>issues caused by the user's own Airtable account, API key, or third-party limits.</li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-2">6. How to Request a Refund</h3>
        <p className="mb-4 text-muted-foreground">Email erentahiroglu@hotmail.com.tr with your full name, purchase email, transaction details, date, and reason for the request.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">7. Review Time</h3>
        <p className="mb-4 text-muted-foreground">We aim to provide an initial response within 5 business days and a decision within 10 business days.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">8. Mandatory Consumer Rights</h3>
        <p className="mb-4 text-muted-foreground">Mandatory withdrawal or refund rights under applicable law remain unaffected.</p>

        <h3 className="text-xl font-semibold mt-6 mb-2">9. Chargebacks</h3>
        <p className="mb-4 text-muted-foreground">Users are expected to try resolving the issue directly with us first. If a chargeback is initiated, relevant transaction info may be provided to Paddle and payment institutions.</p>
      </div>
    </div>
    <Footer />
  </div>
);

export default RefundPage;
