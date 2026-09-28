export declare enum FilterType {
    RANGE = "RANGE",
    SELECT = "SELECT",
    BOOLEAN = "BOOLEAN",
    MULTISELECT = "MULTISELECT"
}
export declare class CreateFacetFilterDto {
    name: string;
    field: string;
    type: FilterType;
    categoryId: string;
    isEnabled?: boolean;
    sortOrder?: number;
    config?: Record<string, any>;
}
