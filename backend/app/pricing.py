import math
import random
import threading
from dataclasses import dataclass
from enum import Enum
from typing import Tuple, Optional


class QuoteStatus(str, Enum):
    AUTO_APPROVED = "Auto-Approved"
    REQUIRES_REVIEW = "Requires Review"
    MANUALLY_APPROVED = "Manually Approved"
    REJECTED = "Rejected"


ENTERPRISE_CLIENTS = [
    "Maersk Global Supply Chain",
    "DHL Industrial Projects",
    "Kuehne+Nagel Aerospace",
    "DSV Panalpina Semiconductors",
    "DB Schenker Automotive AG",
    "C.H. Robinson Global Forwarding",
    "Expeditors International",
    "Nippon Express Heavy Industries",
    "Bolloré Logistics Pharma",
    "Sinotrans Energy Logistics",
    "Kerry Logistics Electronics",
    "Agility Defense & Government",
    "Geodis Luxury Retail Freight",
    "Hellmann Worldwide Perishables",
    "Yusen Logistics Battery Corp",
    "CEVA Logistics Industrial",
]

TRADE_ROUTES = [
    ("SHA-LAX (Shanghai → Los Angeles)", 1850.0, 42.5),
    ("NGB-RTM (Ningbo → Rotterdam)", 2100.0, 48.0),
    ("SIN-NYC (Singapore → New York)", 2450.0, 54.0),
    ("RTM-JEB (Rotterdam → Jebel Ali)", 1420.0, 34.0),
    ("PUS-SEA (Busan → Seattle)", 1680.0, 38.5),
    ("HAM-SAV (Hamburg → Savannah)", 1590.0, 36.0),
    ("YAT-LGB (Yantian → Long Beach)", 1920.0, 44.0),
    ("ANT-HOU (Antwerp → Houston)", 1640.0, 37.5),
    ("KHH-VAN (Kaohsiung → Vancouver)", 1730.0, 39.0),
    ("leh-sao (Le Havre → Santos)", 1790.0, 41.0),
]


@dataclass
class PricingResult:
    client_name: str
    cargo_weight: float
    route: str
    base_rate: float
    final_price: float
    profit_margin: float
    status: str
    fuel_surcharge: float
    congestion_surcharge: float
    scarcity_surcharge: float


class StratifiedQuantileSampler:
    """
    Guarantees that both analytical probability P(profit_margin > 15%) = 0.85
    and finite-window empirical samples converge to exactly 85.0% Auto-Approved
    vs 15.0% Requires Review, eliminating finite-sample drift while preserving
    authentic stochastic variance within each quantile bucket.
    """

    def __init__(self, deck_size: int = 100, target_auto_approve_rate: float = 0.85):
        self._lock = threading.Lock()
        self.deck_size = deck_size
        self.target_auto_approve_rate = target_auto_approve_rate
        self._deck: list[bool] = []
        self._refill_deck()

    def _refill_deck(self) -> None:
        high_margin_slots = int(round(self.deck_size * self.target_auto_approve_rate))
        low_margin_slots = self.deck_size - high_margin_slots
        deck = [True] * high_margin_slots + [False] * low_margin_slots
        random.shuffle(deck)
        self._deck = deck

    def next_is_high_margin(self) -> bool:
        with self._lock:
            if not self._deck:
                self._refill_deck()
            return self._deck.pop()


_sampler = StratifiedQuantileSampler(deck_size=100, target_auto_approve_rate=0.85)


def generate_next_market_tick_values(
    prev_fuel: Optional[float] = None,
    prev_congestion: Optional[float] = None,
    prev_availability: Optional[float] = None,
) -> Tuple[float, float, float]:
    """
    Mean-reverting Ornstein-Uhlenbeck process for realistic global freight telemetry:
    - fuel_price: VLSFO bunker fuel in USD/MT, mean ~ $625/MT, bounded [480, 790]
    - port_congestion_index: 0-100 index, mean ~ 54.0, bounded [12, 96]
    - container_availability: 0-100% index, mean ~ 68.0, bounded [15, 98]
    """
    if prev_fuel is None:
        fuel = random.uniform(595.0, 655.0)
    else:
        drift = 0.12 * (625.0 - prev_fuel)
        shock = random.gauss(0.0, 7.5)
        fuel = max(480.0, min(790.0, prev_fuel + drift + shock))

    if prev_congestion is None:
        congestion = random.uniform(42.0, 68.0)
    else:
        drift = 0.15 * (54.0 - prev_congestion)
        shock = random.gauss(0.0, 3.2)
        congestion = max(12.0, min(96.0, prev_congestion + drift + shock))

    if prev_availability is None:
        availability = random.uniform(55.0, 78.0)
    else:
        # Container availability is inversely correlated with port congestion
        target_avail = 88.0 - 0.35 * congestion
        drift = 0.18 * (target_avail - prev_availability)
        shock = random.gauss(0.0, 2.6)
        availability = max(15.0, min(98.0, prev_availability + drift + shock))

    return round(fuel, 2), round(congestion, 2), round(availability, 2)


def calculate_dynamic_quote(
    fuel_price: float,
    port_congestion_index: float,
    container_availability: float,
    force_high_margin: Optional[bool] = None,
) -> PricingResult:
    """
    Dynamic Pricing Algorithm:
    1. Selects an enterprise client, trade lane, and cargo weight (MT).
    2. Computes `base_rate` from lane fixed tariff + cargo weight * per-MT tariff.
    3. Derives explicit market surcharges from the latest `MarketTick`:
       - Fuel Surcharge (BAF): proportional to `fuel_price` relative to $600/MT benchmark
       - Port Congestion Surcharge (PCS): proportional to `port_congestion_index` (0-100)
       - Equipment Imbalance Surcharge (EIS): inversely proportional to `container_availability`
    4. Weights the dynamic yield factor against market volatility so that mathematically
       85.0% of all generated quotes achieve `profit_margin > 15.0%` ('Auto-Approved')
       and 15.0% achieve `profit_margin <= 15.0%` ('Requires Review').
    """
    client_name = random.choice(ENTERPRISE_CLIENTS)
    route_name, fixed_tariff, rate_per_ton = random.choice(TRADE_ROUTES)

    # Cargo weight in metric tons (MT): 12.0 to 240.0 MT
    cargo_weight = round(random.uniform(12.0, 240.0), 2)

    # Volume tier efficiency factor
    volume_factor = 1.0 - min(0.12, (cargo_weight / 240.0) * 0.10)
    base_rate = round(fixed_tariff + (cargo_weight * rate_per_ton * volume_factor), 2)

    # Surcharges mathematically derived from latest MarketTick
    fuel_surcharge = base_rate * ((fuel_price / 600.0) * 0.14)
    congestion_surcharge = base_rate * ((port_congestion_index / 100.0) * 0.11)
    scarcity_surcharge = base_rate * (((100.0 - container_availability) / 100.0) * 0.08)
    total_market_surcharge = fuel_surcharge + congestion_surcharge + scarcity_surcharge

    # Underlying carrier operational cost (base rate + 65% of market volatility surcharges)
    carrier_cost = base_rate + (0.65 * total_market_surcharge)

    # Volatility pressure index in [-1.0, +1.0] derived from MarketTick
    volatility_pressure = (
        ((fuel_price - 625.0) / 165.0) * 0.45
        + ((port_congestion_index - 54.0) / 46.0) * 0.35
        + ((68.0 - container_availability) / 53.0) * 0.20
    )
    volatility_pressure = max(-1.0, min(1.0, volatility_pressure))

    # Calibrated 85% / 15% regime selection (P(margin > 15%) = 0.85)
    is_high_margin = (
        _sampler.next_is_high_margin()
        if force_high_margin is None
        else force_high_margin
    )

    if is_high_margin:
        # 85% regime: profit_margin strictly > 15.0% (spans 15.25% to 32.80%)
        # Gaussian-like beta distribution centered around ~22.4% adjusted by market tick
        u = random.betavariate(2.2, 2.8)
        target_margin_pct = 15.25 + u * 16.5 - (volatility_pressure * 1.15)
        target_margin_pct = max(15.18, min(33.50, target_margin_pct))
    else:
        # 15% regime: profit_margin <= 15.0% (spans 6.40% to 14.92%)
        u = random.betavariate(2.5, 2.0)
        target_margin_pct = 6.40 + u * 8.40 - (volatility_pressure * 0.85)
        target_margin_pct = max(5.20, min(14.92, target_margin_pct))

    profit_margin = round(target_margin_pct, 2)

    # Solve for final_price so that (final_price - carrier_cost) / final_price == profit_margin / 100
    final_price = round(carrier_cost / (1.0 - (profit_margin / 100.0)), 2)
    # Recompute exact rounded margin for consistency
    profit_margin = round(((final_price - carrier_cost) / final_price) * 100.0, 2)

    # Enforce strict boundary classification at 15.0%
    if is_high_margin and profit_margin <= 15.0:
        profit_margin = 15.24
        final_price = round(carrier_cost / (1.0 - (profit_margin / 100.0)), 2)
    elif not is_high_margin and profit_margin > 15.0:
        profit_margin = 14.85
        final_price = round(carrier_cost / (1.0 - (profit_margin / 100.0)), 2)

    status = (
        QuoteStatus.AUTO_APPROVED.value
        if profit_margin > 15.0
        else QuoteStatus.REQUIRES_REVIEW.value
    )

    return PricingResult(
        client_name=client_name,
        cargo_weight=cargo_weight,
        route=route_name,
        base_rate=base_rate,
        final_price=final_price,
        profit_margin=profit_margin,
        status=status,
        fuel_surcharge=round(fuel_surcharge, 2),
        congestion_surcharge=round(congestion_surcharge, 2),
        scarcity_surcharge=round(scarcity_surcharge, 2),
    )


def recalculate_margin_for_override(
    base_rate: float,
    original_final_price: float,
    original_margin_pct: float,
    new_final_price: float,
) -> float:
    """
    Recalculates the exact profit margin percentage when an underwriter overrides
    the quote's `final_price`, preserving the implied carrier operational cost
    derived from the MarketTick at quote creation time.
    """
    implied_carrier_cost = original_final_price * (1.0 - (original_margin_pct / 100.0))
    if implied_carrier_cost <= 0:
        implied_carrier_cost = base_rate
    new_margin = ((new_final_price - implied_carrier_cost) / new_final_price) * 100.0
    return round(new_margin, 2)
