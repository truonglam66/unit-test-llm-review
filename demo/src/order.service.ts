export interface Item { sku: string; qty: number; price: number }
export interface Inventory { reserve(sku: string, qty: number): Promise<boolean>; release(sku: string, qty: number): Promise<void> }
export interface Payment { charge(customerId: string, amount: number): Promise<{ ok: boolean; txId?: string }> }
export interface OrderRepo { save(order: { customerId: string; items: Item[]; total: number; txId: string }): Promise<{ id: string }> }

export class OrderService {
  constructor(private inventory: Inventory, private payment: Payment, private repo: OrderRepo) {}

  /** Tổng tiền: giảm 10% khi tổng từ 1.000.000 trở lên, tối đa giảm 200.000. */
  computeTotal(items: Item[]): number {
    const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
    const discount = subtotal >= 1_000_000 ? Math.min(subtotal * 0.1, 200_000) : 0;
    return subtotal - discount;
  }

  /** Giữ hàng -> thu tiền -> lưu đơn. Lỗi ở bước nào thì nhả lại toàn bộ hàng đã giữ. */
  async placeOrder(customerId: string, items: Item[]): Promise<{ id: string; total: number }> {
    if (items.length === 0) throw new Error('EMPTY_ORDER');
    if (items.some(i => i.qty <= 0)) throw new Error('INVALID_QTY');

    const reserved: Item[] = [];
    try {
      for (const item of items) {
        const ok = await this.inventory.reserve(item.sku, item.qty);
        if (!ok) throw new Error(`OUT_OF_STOCK:${item.sku}`);
        reserved.push(item);
      }
      const total = this.computeTotal(items);
      const charge = await this.payment.charge(customerId, total);
      if (!charge.ok || !charge.txId) throw new Error('PAYMENT_FAILED');
      const saved = await this.repo.save({ customerId, items, total, txId: charge.txId });
      return { id: saved.id, total };
    } catch (e) {
      for (const item of reserved) await this.inventory.release(item.sku, item.qty);
      throw e;
    }
  }
}
