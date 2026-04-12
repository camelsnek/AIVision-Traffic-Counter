enum VehicleClass {
  car('Car'),
  suv('SUV'),
  van('Van'),
  truck('Truck'),
  bus('Bus'),
  motorcycle('Motorcycle');

  const VehicleClass(this.label);

  final String label;

  static VehicleClass fromWireValue(String value) {
    final normalized = value.trim().toLowerCase();
    return VehicleClass.values.firstWhere(
      (entry) => entry.name == normalized,
      orElse: () => VehicleClass.car,
    );
  }
}
