# Deneme modunda ne gösterilir

Type: prototype
Status: open
Blocked by: —

## Question

Deneme modu script'i transaction içinde çalıştırıp sonunda her zaman rollback eder. Kullanıcıya "değişiklikler" olarak ne gösterilir ve rollback edilecek transaction içinde nasıl toplanır?

Seçenekler: (a) yalnızca ifade başına etkilenen satır sayısı; (b) DML ifadelerine `RETURNING *` ekleyerek etkilenen satırların son hali (ifade yeniden yazma gerekir); (c) etkilenen tabloların PK üzerinden önce/sonra farkı; (d) karma. Sahte bir çalıştırma log ekranı prototipiyle hangisinin gerçekten işe yaradığı görülmeli. DDL ifadeleri ve [transaction dışı komutlar](15-transaction-disi-komutlar.md) deneme modunda nasıl gösterilir?
